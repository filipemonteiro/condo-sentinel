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

import { parseJsonEnv, toInt, htmlResponse, jsonResponse } from './utils.js';
import { getConfig } from './config.js';
import { loadAllDeviceStates, saveAllDeviceStates, loadGlobalState, saveGlobalState, loadDashboardRuntimeConfig, saveDashboardRuntimeConfig, loadDashboardUserMappings, saveDashboardUserMappings } from './state.js';
import { getTuyaToken } from './tuya.js';
import { processDevices } from './devices.js';
import { evaluateAutomations } from './automations.js';
import { buildDashboardStatus, renderDashboardHtml, handleApiHistory } from './dashboard.js';
import { sendTelegramMessage } from './notifications.js';

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

      const payload = await buildDashboardStatus(env);
      return jsonResponse(payload);
    }

    // API de histórico
    if (url.pathname === "/api/history") {
      const authResponse = requireDashboardAuth(request, env);
      if (authResponse) return authResponse;

      const deviceId = url.searchParams.get("device");
      const history = await handleApiHistory(env, deviceId);
      return history;
    }

    // Dashboard HTML
    if (url.pathname === "/dashboard") {
      const cfg = await getConfig(env);
      const currentUser = await getDashboardUser(request, env);
      return htmlResponse(renderDashboardHtml({
        sessionTimeoutMinutes: toInt(env.DASHBOARD_SESSION_TIMEOUT_MINUTES, 30),
        dashboardTitle: cfg.dashboardTitle,
        userRole: currentUser.role,
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
        const fallbackUsers = parseJsonEnv(env.DASHBOARD_USERS_JSON, []);
        const users = Array.isArray(fallbackUsers)
          ? [...fallbackUsers, ...savedUsers]
          : savedUsers;

        return jsonResponse({
          currentUser,
          config: {
            DASHBOARD_TITLE: cfg.dashboardTitle,
            ...(runtimeConfig || {}),
          },
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

        const runtimeConfig = body.config && typeof body.config === 'object' ? body.config : {};
        let normalizedUsers = null;

        if (Array.isArray(body.users)) {
          normalizedUsers = body.users
            .filter(u => u && u.email)
            .map(u => ({
              email: String(u.email).trim().toLowerCase(),
              role: u.role === 'admin' ? 'admin' : 'viewer',
            }));
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

async function getDashboardUser(request, env) {
  const emailHeader = String(request.headers.get('CF-Access-Client-Email') || '').trim();
  const email = emailHeader ? emailHeader.toLowerCase() : null;

  const savedUsers = await loadDashboardUserMappings(env);
  const fallbackUsers = parseJsonEnv(env.DASHBOARD_USERS_JSON, []);
  const users = Array.isArray(fallbackUsers)
    ? [...fallbackUsers, ...savedUsers]
    : savedUsers;

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
async function handleCheck(env) {
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

  // Carrega estados
  const deviceStates = await loadAllDeviceStates(env, enabledDevices);
  const globalState = await loadGlobalState(env);
  const accessToken = await getTuyaToken(env);

  const notifications = [];
  const context = {
    devicesById: {},
    devicesByRole: {},
    readingsByRole: {},
    availabilityByRole: {},
    batchInfoById: {},
  };

  // Processa dispositivos
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

  // Avalia automações
  if (Array.isArray(automations) && automations.length > 0) {
    await evaluateAutomations({
      automations,
      state: globalState,
      now,
      notifications,
      context,
    });
  }

  // Envia notificações
  if (notifications.length > 0) {
    const message = notifications.join("\n\n");
    await sendTelegramMessage(env, message, cfg.dryRun);
  }

  // Salva estados
  await saveAllDeviceStates(env, deviceStates);
  await saveGlobalState(env, globalState);

  console.log("Execução concluída.", {
    deviceCount: enabledDevices.length,
    notifications: notifications.length,
    automationCount: Array.isArray(automations) ? automations.length : 0,
  });
}
