// filepath: src/worker.js
/**
 * Condo Sentinel - Cloudflare Worker
 * Monitoramento de dispositivos IoT para condomínios
 * 
 * Arquitetura modular:
 * - config.js: Configurações e variáveis de ambiente
 * - state.js: Gerenciamento de estado por device
 * - utils.js: Funções utilitárias
 * - tuya.js: Integração com API Tuya
 * - devices.js: Lógica de inspeção de dispositivos
 * - history.js: Gerenciamento de histórico
 * - automations.js: Lógica de automações
 * - dashboard.js: Dashboard e APIs
 */

import { parseJsonEnv, htmlResponse, jsonResponse } from './utils.js';
import { EDITABLE_DEVICE_CONFIG_FIELDS, getConfig, normalizeDashboardRuntimeConfig } from './config.js';
import { loadAllDeviceStates, saveAllDeviceStates, loadGlobalState, saveGlobalState, loadDashboardRuntimeConfig, saveDashboardRuntimeConfig, loadDashboardUserMappings, saveDashboardUserMappings } from './state.js';
import { getTuyaToken } from './tuya.js';
import { applyRuntimeDeviceConfig, processDevices } from './devices.js';
import { evaluateAutomations } from './automations.js';
import { buildDashboardStatus, renderDashboardHtml, handleApiHistory } from './dashboard.js';
import { sendTelegramMessage } from './notifications.js';
import { isAccessJwtConfigured, getVerifiedAccessEmail } from './access.js';

const TUYA_TOKEN_FAULT_MESSAGE =
  "⚠️ Falha ao obter token da Tuya. Verifique credenciais, conectividade ou assinatura da API antes da próxima verificação.";
const TUYA_TOKEN_RECOVERY_MESSAGE =
  "✅ A autenticação com a Tuya foi restabelecida.";

/**
 * Handler principal do worker
 */
export default {
  /**
   * Handler para execução agendada (Cron)
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCheck(env));
  },

  /**
   * Handler para requisições HTTP
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Redirect raiz para dashboard
    if (url.pathname === "/") {
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    // API de status
    if (url.pathname === "/api/status") {
      const authResponse = requireDashboardAuth(request, env);
      if (authResponse) return authResponse;

      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const payload = await buildDashboardStatus(env);
      return jsonResponse(payload);
    }

    // API de histórico
    if (url.pathname === "/api/history") {
      const authResponse = requireDashboardAuth(request, env);
      if (authResponse) return authResponse;

      if (request.method !== "GET") {
        return jsonResponse({ error: "Method not allowed" }, 405);
      }

      const deviceId = url.searchParams.get("device");
      if (!deviceId) {
        return jsonResponse({ error: "Device ID required" }, 400);
      }

      if (!isRegisteredDeviceId(env, deviceId)) {
        return jsonResponse({ error: "Unknown device" }, 404);
      }

      return await handleApiHistory(env, deviceId);
    }

    // Dashboard HTML
    if (url.pathname === "/dashboard") {
      const cfg = await getConfig(env);
      return htmlResponse(renderDashboardHtml({
        sessionTimeoutMinutes: cfg.dashboardSessionTimeoutMinutes,
        dashboardTitle: cfg.dashboardTitle,
      }));
    }

    // Dashboard context and admin endpoints
    if (url.pathname === "/api/dashboard-context") {
      const authResponse = requireDashboardAuth(request, env);
      if (authResponse) return authResponse;

      const currentUser = await getDashboardUser(request, env);
      if (request.method === "GET") {
        const cfg = await getConfig(env);
        const runtimeConfig = await loadDashboardRuntimeConfig(env);
        const savedUsers = await loadDashboardUserMappings(env);
        const users = mergeUsers(parseJsonEnv(env.DASHBOARD_USERS_JSON, []), savedUsers);

        return jsonResponse({
          currentUser,
          config: {
            ...buildEditableConfigPayload(cfg),
            ...(runtimeConfig || {}),
          },
          devices: currentUser.role === 'admin'
            ? buildEditableDeviceConfigPayload(parseJsonEnv(env.DEVICE_REGISTRY_JSON, []), cfg)
            : [],
          users: currentUser.role === 'admin' ? users : [],
        });
      }

      if (request.method === "POST") {
        if (currentUser.role !== 'admin') {
          return jsonResponse({ error: 'Forbidden' }, 403);
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return jsonResponse({ error: 'Invalid payload' }, 400);
        }

        const runtimeConfig = normalizeDashboardRuntimeConfig(
          body.config && typeof body.config === 'object' ? body.config : {}
        );
        let normalizedUsers = null;

        if (Array.isArray(body.users)) {
          normalizedUsers = body.users
            .filter(u => u && u.email)
            .map(u => ({
              email: String(u.email).trim().toLowerCase(),
              role: u.role === 'admin' ? 'admin' : 'viewer',
            }));

          // Anti-lockout: a lista efetiva (env + KV) precisa manter ao menos um admin
          const effectiveUsers = mergeUsers(parseJsonEnv(env.DASHBOARD_USERS_JSON, []), normalizedUsers);
          if (!effectiveUsers.some(u => u?.role === 'admin')) {
            return jsonResponse({ error: 'At least one admin user is required.' }, 400);
          }
        }

        await saveDashboardRuntimeConfig(env, runtimeConfig);
        if (normalizedUsers) {
          await saveDashboardUserMappings(env, normalizedUsers);
        }

        return jsonResponse({
          success: true,
          config: runtimeConfig,
          users: normalizedUsers || undefined,
        });
      }

      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    return new Response("Not found", { status: 404 });
  }
};

function buildEditableConfigPayload(cfg) {
  return {
    DASHBOARD_TITLE: cfg.dashboardTitle,
    DASHBOARD_STALE_AFTER_MINUTES: cfg.dashboardStaleAfterMinutes,
    DASHBOARD_SESSION_TIMEOUT_MINUTES: cfg.dashboardSessionTimeoutMinutes,
    COOLDOWN_MINUTES: Math.round(cfg.defaultCooldownMs / 60_000),
    OFFLINE_COOLDOWN_MINUTES: Math.round(cfg.defaultOfflineCooldownMs / 60_000),
    SENSOR_COOLDOWN_MINUTES: Math.round(cfg.defaultFaultCooldownMs / 60_000),
    BATTERY_THRESHOLD_PERCENT: cfg.batteryThresholdPercent,
    BATTERY_COOLDOWN_MINUTES: Math.round(cfg.batteryCooldownMs / 60_000),
    HISTORY_MAX_POINTS: cfg.historyMaxPoints,
    HISTORY_MIN_INTERVAL_MINUTES: cfg.historyMinIntervalMinutes,
    HISTORY_MIN_DELTA_PERCENT: cfg.historyMinDeltaPercent,
    devices: cfg.deviceConfigs || {},
  };
}

function buildEditableDeviceConfigPayload(devices, cfg) {
  if (!Array.isArray(devices)) return [];

  return devices
    .filter(device => device && device.id && device.type)
    .map(device => {
      const configured = applyRuntimeDeviceConfig(device, cfg);
      const editableConfig = buildEffectiveDeviceConfig(configured, cfg);

      return {
        id: device.id,
        name: device.name || device.id,
        role: device.role || null,
        type: device.type,
        config: editableConfig,
      };
    });
}

function buildEffectiveDeviceConfig(device, cfg) {
  const defaults = buildDeviceConfigDefaults(device, cfg);
  const editableConfig = {};

  for (const field of Object.keys(defaults)) {
    editableConfig[field] = device[field] ?? defaults[field];
  }

  return editableConfig;
}

function buildDeviceConfigDefaults(device, cfg) {
  const common = {
    offlineCooldownMinutes: Math.round(cfg.defaultOfflineCooldownMs / 60_000),
    faultCooldownMinutes: Math.round(cfg.defaultFaultCooldownMs / 60_000),
  };
  const battery = {
    batteryThresholdPercent: cfg.batteryThresholdPercent,
    batteryCooldownMinutes: Math.round(cfg.batteryCooldownMs / 60_000),
  };

  if (device.type === 'water_level_sensor') {
    return {
      thresholdPercent: 20,
      recoveryMarginPercent: 10,
      minConsecutiveBreaches: 2,
      cooldownMinutes: Math.round(cfg.defaultCooldownMs / 60_000),
      ...common,
      ...battery,
    };
  }

  if (device.type === 'gas_sensor' || device.type === 'water_leak_sensor') {
    return {
      ...common,
      ...battery,
    };
  }

  if (device.type === 'valve') {
    return common;
  }

  return common;
}

function requireDashboardAuth(request, env) {
  const expectedToken = String(env.DASHBOARD_ACCESS_TOKEN || "").trim();

  if (!expectedToken) {
    return jsonResponse(
      { error: "DASHBOARD_ACCESS_TOKEN is not configured." },
      503
    );
  }

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!token || !constantTimeEqual(token, expectedToken)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return null;
}

function mergeUsers(envUsers, kvUsers) {
  const merged = new Map();
  for (const u of (Array.isArray(envUsers) ? envUsers : [])) {
    if (u?.email) merged.set(String(u.email).trim().toLowerCase(), u);
  }
  // KV entries override env vars — they were set explicitly by an admin
  for (const u of kvUsers) {
    if (u?.email) merged.set(String(u.email).trim().toLowerCase(), u);
  }
  return [...merged.values()];
}

async function getDashboardUser(request, env) {
  let email = null;

  if (isAccessJwtConfigured(env)) {
    // Modo verificado: e-mail só é aceito do JWT assinado pelo Cloudflare Access.
    // Headers simples são ignorados porque podem ser forjados pelo cliente.
    email = await getVerifiedAccessEmail(request, env);
  } else {
    const emailHeader = String(
      request.headers.get('Cf-Access-Authenticated-User-Email') ||
      request.headers.get('CF-Access-Client-Email') ||
      ''
    ).trim();
    email = emailHeader ? emailHeader.toLowerCase() : null;
  }

  const savedUsers = await loadDashboardUserMappings(env);
  const users = mergeUsers(parseJsonEnv(env.DASHBOARD_USERS_JSON, []), savedUsers);

  const matched = users.find(user =>
    user && user.email && String(user.email).trim().toLowerCase() === email
  );

  return {
    email: email || 'unknown',
    role: matched?.role === 'admin' ? 'admin' : 'viewer',
  };
}

function constantTimeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < maxLength; i += 1) {
    diff |= left.charCodeAt(i % left.length) ^ right.charCodeAt(i % right.length);
  }

  return diff === 0;
}

/**
 * Função principal de verificação
 */
export async function handleCheck(env) {
  const now = Date.now();

  // Carrega configuração
  const cfg = await getConfig(env);

  // Carrega dispositivos e automações
  const devices = parseJsonEnv(env.DEVICE_REGISTRY_JSON, []);
  const automations = parseJsonEnv(env.AUTOMATIONS_JSON, []);

  if (!Array.isArray(devices) || devices.length === 0) {
    console.warn("DEVICE_REGISTRY_JSON ausente, inválido ou vazio.");
    return;
  }

  for (const device of devices) {
    if (!device?.id) console.warn("Device sem 'id' encontrado no DEVICE_REGISTRY_JSON, será ignorado. Dados omitidos por segurança.");
    if (!device?.type) console.warn("Device sem 'type' encontrado no DEVICE_REGISTRY_JSON, será ignorado. ID omitido por segurança.");
  }

  const enabledDevices = devices.filter(
    device => device && device.id && device.type && device.enabled !== false
  );

  if (enabledDevices.length === 0) {
    console.warn("Nenhum device habilitado encontrado no DEVICE_REGISTRY_JSON.");
    return;
  }

  // Carrega estados — globalState primeiro para reaproveitar devices legados na migração
  const globalState = await loadGlobalState(env);
  const deviceStates = await loadAllDeviceStates(env, enabledDevices, globalState.devices);

  const notifications = [];
  const context = {
    devicesById: {},
    devicesByRole: {},
    readingsByRole: {},
    availabilityByRole: {},
    batchInfoById: {},
  };

  let accessToken = null;
  try {
    accessToken = await getTuyaToken(env);
    recordTuyaTokenRecovery(globalState, now, notifications);
  } catch (err) {
    console.error("Falha ao obter token da Tuya; verificação de devices será ignorada.", err);
    recordTuyaTokenFault(globalState, cfg, now, notifications);
  }

  // Processa dispositivos
  if (accessToken) {
    await processDevices(
      env,
      accessToken,
      enabledDevices,
      deviceStates,
      cfg,
      now,
      notifications,
      context
    );
  }

  // Avalia automações apenas quando a coleta Tuya ocorreu nesta execução.
  if (accessToken && Array.isArray(automations) && automations.length > 0) {
    await evaluateAutomations({
      automations,
      state: globalState,
      now,
      notifications,
      context,
    });
  }

  let notificationError = null;
  globalState.pendingNotifications = removePendingNotificationsForRecoveries(
    globalState.pendingNotifications,
    notifications
  );

  const {
    deferredPendingNotifications,
    notificationsToSend,
  } = buildNotificationBatch(globalState.pendingNotifications, notifications, now);

  try {
    if (notificationsToSend.length > 0) {
      const message = notificationsToSend.join("\n\n");
      await sendTelegramMessage(env, message, cfg.dryRun);
    }
    globalState.pendingNotifications = deferredPendingNotifications;
  } catch (err) {
    notificationError = err;
    globalState.pendingNotifications = mergePendingNotifications(
      deferredPendingNotifications,
      notificationsToSend.map(message => ({
        message,
        lastAttemptAt: now,
        nextAttemptAt: now + cfg.defaultFaultCooldownMs,
      }))
    );
    console.error("Falha ao enviar notificações; estados serão persistidos mesmo assim.", err);
  } finally {
    await saveAllDeviceStates(env, deviceStates);
    await saveGlobalState(env, globalState);
  }

  console.log("Execução concluída.", {
    deviceCount: enabledDevices.length,
    notifications: notificationsToSend.length,
    automationCount: Array.isArray(automations) ? automations.length : 0,
  });

  if (notificationError) {
    throw notificationError;
  }
}

function dedupeNotifications(messages) {
  return [...new Set((Array.isArray(messages) ? messages : [])
    .filter(Boolean)
    .map(message => String(message)))];
}

function buildNotificationBatch(pendingNotifications, notifications, now) {
  const normalizedPending = normalizePendingNotifications(pendingNotifications);
  const deferredPendingNotifications = normalizedPending.filter(item => item.nextAttemptAt > now);
  const duePendingMessages = normalizedPending
    .filter(item => item.nextAttemptAt <= now)
    .map(item => item.message);

  return {
    deferredPendingNotifications,
    notificationsToSend: dedupeNotifications([
      ...duePendingMessages,
      ...(Array.isArray(notifications) ? notifications : []),
    ]),
  };
}

function normalizePendingNotifications(pendingNotifications) {
  if (!Array.isArray(pendingNotifications)) return [];

  return pendingNotifications
    .map(item => {
      if (typeof item === 'string') {
        return {
          message: item,
          lastAttemptAt: 0,
          nextAttemptAt: 0,
        };
      }

      if (!item || typeof item !== 'object' || !item.message) return null;

      return {
        message: String(item.message),
        lastAttemptAt: Number.isFinite(item.lastAttemptAt) ? item.lastAttemptAt : 0,
        nextAttemptAt: Number.isFinite(item.nextAttemptAt) ? item.nextAttemptAt : 0,
      };
    })
    .filter(Boolean);
}

function removePendingNotificationsByMessage(pendingNotifications, message) {
  return normalizePendingNotifications(pendingNotifications)
    .filter(item => item.message !== message);
}

function removePendingNotificationsForRecoveries(pendingNotifications, notifications) {
  const normalizedPending = normalizePendingNotifications(pendingNotifications);
  const recoveryMessages = Array.isArray(notifications)
    ? notifications.map(String)
    : [];

  const removalPatterns = [];

  for (const recoveryMessage of recoveryMessages) {
    if (recoveryMessage === TUYA_TOKEN_RECOVERY_MESSAGE) {
      removalPatterns.push(message => message === TUYA_TOKEN_FAULT_MESSAGE);
      continue;
    }

    const exactMatch = (prefix, recoveryRegex) => {
      const match = recoveryMessage.match(recoveryRegex);
      if (!match) return;
      const target = match[1];
      const failurePrefix = `${prefix}${target}"`;
      removalPatterns.push(message => message.startsWith(failurePrefix));
    };

    exactMatch('⚠️ Falha ao consultar o device "', /^✅ A consulta ao device "([^"]+)" foi restabelecida\.$/);
    exactMatch('⚠️ O device "', /^✅ O device "([^"]+)" voltou a ficar online\.$/);
    exactMatch('🚨 O device "', /^✅ O device "([^"]+)" saiu do estado de alarme\.$/);
    exactMatch('⚠️ A bateria do device "', /^✅ A bateria do device "([^"]+)" foi recuperada para /);
    exactMatch('⚠️ O sensor "', /^✅ A leitura do sensor "([^"]+)" foi restabelecida\. Nível atual: /);
    exactMatch('⚠️ O nível do sensor "', /^✅ O nível do sensor "([^"]+)" normalizou em /);
  }

  if (removalPatterns.length === 0) {
    return normalizedPending;
  }

  return normalizedPending.filter(item => {
    for (const shouldRemove of removalPatterns) {
      if (shouldRemove(item.message)) {
        return false;
      }
    }
    return true;
  });
}

function mergePendingNotifications(left, right) {
  const byMessage = new Map();
  for (const item of [...normalizePendingNotifications(left), ...normalizePendingNotifications(right)]) {
    byMessage.set(item.message, item);
  }
  return [...byMessage.values()];
}

function recordTuyaTokenFault(globalState, cfg, now, notifications) {
  globalState.integrations = globalState.integrations || {};
  const tuyaState = globalState.integrations.tuya || {};
  const cooldownMs = cfg.defaultFaultCooldownMs;
  const shouldNotify =
    !tuyaState.tokenFaultActive ||
    now - (tuyaState.lastTokenFaultAlertAt || 0) > cooldownMs;

  if (shouldNotify) {
    notifications.push(TUYA_TOKEN_FAULT_MESSAGE);
    tuyaState.lastTokenFaultAlertAt = now;
  }

  tuyaState.tokenFaultActive = true;
  tuyaState.lastTokenFaultAt = now;
  globalState.integrations.tuya = tuyaState;
}

function recordTuyaTokenRecovery(globalState, now, notifications) {
  const tuyaState = globalState.integrations?.tuya;
  if (!tuyaState?.tokenFaultActive) return;

  globalState.pendingNotifications = removePendingNotificationsByMessage(
    globalState.pendingNotifications,
    TUYA_TOKEN_FAULT_MESSAGE
  );

  notifications.push(TUYA_TOKEN_RECOVERY_MESSAGE);
  tuyaState.tokenFaultActive = false;
  tuyaState.lastTokenRecoveryAt = now;
  globalState.integrations.tuya = tuyaState;
}

function isRegisteredDeviceId(env, deviceId) {
  if (!deviceId) return false;

  const devices = parseJsonEnv(env.DEVICE_REGISTRY_JSON, []);
  if (!Array.isArray(devices)) return false;

  return devices.some(device =>
    device &&
    device.id &&
    String(device.id) === String(deviceId)
  );
}
