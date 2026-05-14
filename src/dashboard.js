// filepath: src/dashboard.js
/**
 * Dashboard HTML e construção de status
 */

import { toInt, parseJsonEnv, jsonResponse, htmlResponse } from './utils.js';
import { loadAllDeviceStates, createDefaultDeviceState } from './state.js';
import { getDeviceHistory } from './history.js';
import { renderDashboardHtml } from './dashboard-template.js';

/**
 * Constrói payload de status para o dashboard
 */
export async function buildDashboardStatus(env) {
  const devices = parseJsonEnv(env.DEVICE_REGISTRY_JSON, []);
  const automations = parseJsonEnv(env.AUTOMATIONS_JSON, []);
  const now = Date.now();
  const staleAfterMinutes = toInt(env.DASHBOARD_STALE_AFTER_MINUTES, 30);
  const staleAfterMs = staleAfterMinutes * 60 * 1000;

  // Carrega estados isolados por device
  const deviceStates = await loadAllDeviceStates(env, devices);

  const deviceViews = (Array.isArray(devices) ? devices : []).map(device => {
    const dState = deviceStates[device.id] || createDefaultDeviceState(device);
    const readingUpdatedAt = dState.lastReading?.readingUpdatedAt || null;
    const isStale =
      !!readingUpdatedAt && now - readingUpdatedAt > staleAfterMs;

    return {
      id: device.id,
      name: device.name || device.id,
      role: device.role || null,
      type: device.type,
      enabled: device.enabled !== false,
      online: dState.lastBatchIsOnline === true,
      stale: isStale,
      readingUpdatedAt,
      offlineAlertActive: !!dState.offlineAlertActive,
      sensorFaultActive: !!dState.sensorFaultActive,
      lowLevelAlertActive: !!dState.lowLevelAlertActive,
      batteryLowAlertActive: !!dState.batteryLowAlertActive,
      alarmActive: !!dState.alarmActive,
      lastSeenAt: dState.lastSeenAt || null,
      lastReading: dState.lastReading || null,
      lastBatchInfo: dState.lastBatchInfo || null,
      breachCount: dState.breachCount || 0,
    };
  });

  const summary = {
    totalDevices: deviceViews.length,
    onlineDevices: deviceViews.filter(d => d.online).length,
    offlineDevices: deviceViews.filter(d => !d.online).length,
    staleDevices: deviceViews.filter(d => d.stale).length,
    devicesInAlarm: deviceViews.filter(d => d.alarmActive).length,
    devicesWithFault: deviceViews.filter(d => d.sensorFaultActive).length,
    devicesLowLevel: deviceViews.filter(d => d.lowLevelAlertActive).length,
    automationCount: Array.isArray(automations) ? automations.length : 0,
  };

  return {
    summary,
    devices: deviceViews,
    automations: {}, // TODO: carregar automations isoladamente
    generatedAt: now,
    staleAfterMinutes,
  };
}

/**
 * Escapa texto inserido diretamente no HTML renderizado pelo worker.
 */
export function escapeHtmlText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Re-export for convenience
export { renderDashboardHtml } from './dashboard-template.js';

/**
 * Handle API history request
 */
export async function handleApiHistory(env, deviceId) {
  if (!deviceId) {
    return jsonResponse({ error: "Device ID required" }, 400);
  }

  const history = await getDeviceHistory(env, deviceId);
  return jsonResponse(history);
}
