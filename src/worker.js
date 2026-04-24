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

import { parseJsonEnv, toInt, toBool, htmlResponse } from './utils.js';
import { loadAllDeviceStates, saveAllDeviceStates, loadGlobalState, saveGlobalState } from './state.js';
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
      const payload = await buildDashboardStatus(env);
      return new Response(JSON.stringify(payload, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // API de histórico
    if (url.pathname === "/api/history") {
      const deviceId = url.searchParams.get("device");
      const history = await handleApiHistory(env, deviceId);
      return history;
    }

    // Dashboard HTML
    if (url.pathname === "/dashboard") {
      return htmlResponse(renderDashboardHtml());
    }

    return new Response("Not found", { status: 404 });
  }
};

/**
 * Função principal de verificação
 */
async function handleCheck(env) {
  const now = Date.now();

  // Carrega configuração
  const cfg = {
    dryRun: toBool(env.DRY_RUN, true),
    logFullPayload: toBool(env.LOG_FULL_PAYLOAD, false),
    defaultCooldownMs: toInt(env.COOLDOWN_MINUTES, 60) * 60 * 1000,
    defaultOfflineCooldownMs: toInt(env.OFFLINE_COOLDOWN_MINUTES, 180) * 60 * 1000,
    defaultFaultCooldownMs: toInt(env.SENSOR_COOLDOWN_MINUTES, 60) * 60 * 1000,
  };

  // Carrega dispositivos e automações
  const devices = parseJsonEnv(env.DEVICE_REGISTRY_JSON, []);
  const automations = parseJsonEnv(env.AUTOMATIONS_JSON, []);

  if (!Array.isArray(devices) || devices.length === 0) {
    console.warn("DEVICE_REGISTRY_JSON ausente, inválido ou vazio.");
    return;
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