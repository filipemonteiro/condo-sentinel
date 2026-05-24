// filepath: src/config.js
/**
 * Configurações e variáveis de ambiente do worker
 * Todas as variáveis necessárias para o sistema
 */

import { toInt, toNumber, toBool } from './utils.js';
import { loadDashboardRuntimeConfig } from './state.js';

const DEFAULT_CONFIG = {
  // Comportamento
  DRY_RUN: true,
  LOG_FULL_PAYLOAD: false,
  
  // Cooldowns (em minutos)
  COOLDOWN_MINUTES: 60,
  OFFLINE_COOLDOWN_MINUTES: 180,
  SENSOR_COOLDOWN_MINUTES: 60,
  
  // Histórico
  HISTORY_MIN_INTERVAL_MINUTES: 15,
  HISTORY_MIN_DELTA_PERCENT: 2,
  HISTORY_MAX_POINTS: 288,
  
  // Dashboard
  DASHBOARD_STALE_AFTER_MINUTES: 30,
  DASHBOARD_SESSION_TIMEOUT_MINUTES: 30,
  DASHBOARD_TITLE: 'Condo Sentinel',
  BATTERY_THRESHOLD_PERCENT: 20,
  BATTERY_COOLDOWN_MINUTES: 180,
};

export const EDITABLE_RUNTIME_CONFIG_FIELDS = [
  'DASHBOARD_TITLE',
  'DASHBOARD_STALE_AFTER_MINUTES',
  'DASHBOARD_SESSION_TIMEOUT_MINUTES',
  'COOLDOWN_MINUTES',
  'OFFLINE_COOLDOWN_MINUTES',
  'SENSOR_COOLDOWN_MINUTES',
  'BATTERY_THRESHOLD_PERCENT',
  'BATTERY_COOLDOWN_MINUTES',
  'HISTORY_MAX_POINTS',
  'HISTORY_MIN_INTERVAL_MINUTES',
  'HISTORY_MIN_DELTA_PERCENT',
];

export const EDITABLE_DEVICE_CONFIG_FIELDS = [
  'thresholdPercent',
  'recoveryMarginPercent',
  'minConsecutiveBreaches',
  'cooldownMinutes',
  'offlineCooldownMinutes',
  'faultCooldownMinutes',
  'batteryThresholdPercent',
  'batteryCooldownMinutes',
];

const RUNTIME_CONFIG_RULES = {
  DASHBOARD_STALE_AFTER_MINUTES: { min: 1, max: 1440 },
  DASHBOARD_SESSION_TIMEOUT_MINUTES: { min: 1, max: 1440 },
  COOLDOWN_MINUTES: { min: 1, max: 10080 },
  OFFLINE_COOLDOWN_MINUTES: { min: 1, max: 10080 },
  SENSOR_COOLDOWN_MINUTES: { min: 1, max: 10080 },
  BATTERY_THRESHOLD_PERCENT: { min: 0, max: 100 },
  BATTERY_COOLDOWN_MINUTES: { min: 1, max: 10080 },
  HISTORY_MAX_POINTS: { min: 1, max: 10080 },
  HISTORY_MIN_INTERVAL_MINUTES: { min: 1, max: 1440 },
  HISTORY_MIN_DELTA_PERCENT: { min: 0, max: 100 },
};

const DEVICE_CONFIG_RULES = {
  thresholdPercent: { min: 0, max: 100 },
  recoveryMarginPercent: { min: 0, max: 100 },
  minConsecutiveBreaches: { min: 1, max: 100 },
  cooldownMinutes: { min: 1, max: 10080 },
  offlineCooldownMinutes: { min: 1, max: 10080 },
  faultCooldownMinutes: { min: 1, max: 10080 },
  batteryThresholdPercent: { min: 0, max: 100 },
  batteryCooldownMinutes: { min: 1, max: 10080 },
};

/**
 * Retorna a configuração processada a partir das variáveis de ambiente
 */
async function getConfig(env) {
  const runtimeConfig = normalizeDashboardRuntimeConfig(await loadDashboardRuntimeConfig(env));
  const valueFor = (name) => runtimeConfig[name] ?? env[name] ?? DEFAULT_CONFIG[name];

  return {
    dryRun: toBool(valueFor('DRY_RUN'), DEFAULT_CONFIG.DRY_RUN),
    logFullPayload: toBool(valueFor('LOG_FULL_PAYLOAD'), DEFAULT_CONFIG.LOG_FULL_PAYLOAD),
    defaultCooldownMs: toInt(valueFor('COOLDOWN_MINUTES'), DEFAULT_CONFIG.COOLDOWN_MINUTES) * 60 * 1000,
    defaultOfflineCooldownMs: toInt(valueFor('OFFLINE_COOLDOWN_MINUTES'), DEFAULT_CONFIG.OFFLINE_COOLDOWN_MINUTES) * 60 * 1000,
    defaultFaultCooldownMs: toInt(valueFor('SENSOR_COOLDOWN_MINUTES'), DEFAULT_CONFIG.SENSOR_COOLDOWN_MINUTES) * 60 * 1000,
    batteryThresholdPercent: toInt(valueFor('BATTERY_THRESHOLD_PERCENT'), DEFAULT_CONFIG.BATTERY_THRESHOLD_PERCENT),
    batteryCooldownMs: toInt(valueFor('BATTERY_COOLDOWN_MINUTES'), DEFAULT_CONFIG.BATTERY_COOLDOWN_MINUTES) * 60 * 1000,
    historyMinIntervalMinutes: toInt(valueFor('HISTORY_MIN_INTERVAL_MINUTES'), DEFAULT_CONFIG.HISTORY_MIN_INTERVAL_MINUTES),
    historyMinDeltaPercent: toNumber(valueFor('HISTORY_MIN_DELTA_PERCENT')) ?? DEFAULT_CONFIG.HISTORY_MIN_DELTA_PERCENT,
    historyMaxPoints: toInt(valueFor('HISTORY_MAX_POINTS'), DEFAULT_CONFIG.HISTORY_MAX_POINTS),
    dashboardStaleAfterMinutes: toInt(valueFor('DASHBOARD_STALE_AFTER_MINUTES'), DEFAULT_CONFIG.DASHBOARD_STALE_AFTER_MINUTES),
    dashboardSessionTimeoutMinutes: toInt(valueFor('DASHBOARD_SESSION_TIMEOUT_MINUTES'), DEFAULT_CONFIG.DASHBOARD_SESSION_TIMEOUT_MINUTES),
    dashboardTitle: String(valueFor('DASHBOARD_TITLE') || DEFAULT_CONFIG.DASHBOARD_TITLE),
    runtimeConfig,
    deviceConfigs: runtimeConfig.devices || {},
  };
}

export function normalizeDashboardRuntimeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const source = {
    ...input,
    DASHBOARD_TITLE: input.DASHBOARD_TITLE ?? input.dashboardTitle,
  };
  const normalized = {};

  for (const field of EDITABLE_RUNTIME_CONFIG_FIELDS) {
    if (source[field] === undefined || source[field] === null || source[field] === '') continue;
    if (field === 'DASHBOARD_TITLE') {
      normalized[field] = String(source[field]).trim().slice(0, 120);
    } else if (field === 'HISTORY_MIN_DELTA_PERCENT') {
      const value = normalizeBoundedNumber(source[field], RUNTIME_CONFIG_RULES[field]);
      if (value !== null) normalized[field] = value;
    } else {
      const value = normalizeBoundedInt(source[field], RUNTIME_CONFIG_RULES[field]);
      if (value !== null) normalized[field] = value;
    }
  }

  if (input.devices && typeof input.devices === 'object' && !Array.isArray(input.devices)) {
    const devices = {};
    for (const [deviceKey, config] of Object.entries(input.devices)) {
      if (!deviceKey || !config || typeof config !== 'object' || Array.isArray(config)) continue;

      const safeConfig = {};
      for (const field of EDITABLE_DEVICE_CONFIG_FIELDS) {
        if (config[field] === undefined || config[field] === null || config[field] === '') continue;
        const value = normalizeBoundedInt(config[field], DEVICE_CONFIG_RULES[field]);
        if (value !== null) safeConfig[field] = value;
      }

      if (Object.keys(safeConfig).length > 0) {
        devices[String(deviceKey)] = safeConfig;
      }
    }

    if (Object.keys(devices).length > 0) normalized.devices = devices;
  }

  return normalized;
}

function normalizeBoundedInt(value, rule) {
  const parsed = toInt(value, null);
  if (!Number.isFinite(parsed)) return null;
  if (!rule) return parsed;
  if (parsed < rule.min || parsed > rule.max) return null;
  return parsed;
}

function normalizeBoundedNumber(value, rule) {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed)) return null;
  if (!rule) return parsed;
  if (parsed < rule.min || parsed > rule.max) return null;
  return parsed;
}

export default {
  DEFAULT_CONFIG,
  getConfig,
};

export { getConfig };
