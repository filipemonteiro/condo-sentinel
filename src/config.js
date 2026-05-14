// filepath: src/config.js
/**
 * Configurações e variáveis de ambiente do worker
 * Todas as variáveis necessárias para o sistema
 */

import { toInt, toBool } from './utils.js';
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

/**
 * Retorna a configuração processada a partir das variáveis de ambiente
 */
async function getConfig(env) {
  const runtimeConfig = normalizeDashboardRuntimeConfig(await loadDashboardRuntimeConfig(env));
  const valueFor = (name) => runtimeConfig[name] ?? env[name] ?? DEFAULT_CONFIG[name];

  return {
    dryRun: toBool(env.DRY_RUN, DEFAULT_CONFIG.DRY_RUN),
    logFullPayload: toBool(env.LOG_FULL_PAYLOAD, DEFAULT_CONFIG.LOG_FULL_PAYLOAD),
    defaultCooldownMs: toInt(valueFor('COOLDOWN_MINUTES'), DEFAULT_CONFIG.COOLDOWN_MINUTES) * 60 * 1000,
    defaultOfflineCooldownMs: toInt(valueFor('OFFLINE_COOLDOWN_MINUTES'), DEFAULT_CONFIG.OFFLINE_COOLDOWN_MINUTES) * 60 * 1000,
    defaultFaultCooldownMs: toInt(valueFor('SENSOR_COOLDOWN_MINUTES'), DEFAULT_CONFIG.SENSOR_COOLDOWN_MINUTES) * 60 * 1000,
    batteryThresholdPercent: toInt(valueFor('BATTERY_THRESHOLD_PERCENT'), DEFAULT_CONFIG.BATTERY_THRESHOLD_PERCENT),
    batteryCooldownMs: toInt(valueFor('BATTERY_COOLDOWN_MINUTES'), DEFAULT_CONFIG.BATTERY_COOLDOWN_MINUTES) * 60 * 1000,
    historyMinIntervalMinutes: toInt(valueFor('HISTORY_MIN_INTERVAL_MINUTES'), DEFAULT_CONFIG.HISTORY_MIN_INTERVAL_MINUTES),
    historyMinDeltaPercent: toInt(valueFor('HISTORY_MIN_DELTA_PERCENT'), DEFAULT_CONFIG.HISTORY_MIN_DELTA_PERCENT),
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
      normalized[field] = String(source[field]).slice(0, 120);
    } else {
      const value = toInt(source[field], null);
      if (Number.isFinite(value)) normalized[field] = value;
    }
  }

  if (input.devices && typeof input.devices === 'object' && !Array.isArray(input.devices)) {
    const devices = {};
    for (const [deviceKey, config] of Object.entries(input.devices)) {
      if (!deviceKey || !config || typeof config !== 'object' || Array.isArray(config)) continue;

      const safeConfig = {};
      for (const field of EDITABLE_DEVICE_CONFIG_FIELDS) {
        if (config[field] === undefined || config[field] === null || config[field] === '') continue;
        const value = toInt(config[field], null);
        if (Number.isFinite(value)) safeConfig[field] = value;
      }

      if (Object.keys(safeConfig).length > 0) {
        devices[String(deviceKey)] = safeConfig;
      }
    }

    if (Object.keys(devices).length > 0) normalized.devices = devices;
  }

  return normalized;
}

/**
 * Lista todas as variáveis de ambiente necessárias
 */
function getRequiredEnvVars() {
  return [
    // Tuya API (obrigatório)
    { name: 'CLIENT_ID', required: true, description: 'Client ID da API Tuya' },
    { name: 'CLIENT_SECRET', required: true, description: 'Client Secret da API Tuya' },
    { name: 'TUYA_BASE', required: true, description: 'URL base da API Tuya (ex: https://openapi.tuyaus.com)' },
    
    // Telegram (obrigatório para alertas)
    { name: 'TELEGRAM_BOT_TOKEN', required: true, description: 'Token do bot do Telegram' },
    { name: 'TELEGRAM_CHAT_ID', required: true, description: 'ID do chat para enviar alertas' },
    
    // Dispositivos (obrigatório)
    { name: 'DEVICE_REGISTRY_JSON', required: true, description: 'JSON array com configuração dos dispositivos' },
    
    // Automations (opcional)
    { name: 'AUTOMATIONS_JSON', required: false, description: 'JSON array com configuração das automações' },
  ];
}

/**
 * Lista todas as variáveis de ambiente opcionais
 */
function getOptionalEnvVars() {
  return [
    // Comportamento
    { name: 'DRY_RUN', default: 'true', description: 'Se true, não envia mensagens Telegram' },
    { name: 'LOG_FULL_PAYLOAD', default: 'false', description: 'Se true, loga payloads completos da API' },
    
    // Cooldowns (em minutos)
    { name: 'COOLDOWN_MINUTES', default: '60', description: 'Cooldown padrão para alertas de nível baixo' },
    { name: 'OFFLINE_COOLDOWN_MINUTES', default: '180', description: 'Cooldown para alertas de device offline' },
    { name: 'SENSOR_COOLDOWN_MINUTES', default: '60', description: 'Cooldown para alertas de falha de sensor' },
    
    // Histórico
    { name: 'HISTORY_MIN_INTERVAL_MINUTES', default: '15', description: 'Intervalo mínimo entre pontos de histórico' },
    { name: 'HISTORY_MIN_DELTA_PERCENT', default: '2', description: 'Delta mínimo de % para registrar histórico' },
    { name: 'HISTORY_MAX_POINTS', default: '288', description: 'Máximo de pontos de histórico por device' },
    
    // Dashboard
    { name: 'DASHBOARD_STALE_AFTER_MINUTES', default: '30', description: 'Minutos para considerar dado stale' },
    { name: 'DASHBOARD_SESSION_TIMEOUT_MINUTES', default: '30', description: 'Timeout de sessão do dashboard' },
    { name: 'DASHBOARD_TITLE', default: 'Condo Sentinel', description: 'Título customizado do dashboard' },
    { name: 'BATTERY_THRESHOLD_PERCENT', default: '20', description: 'Percetual de bateria considerado baixo' },
    { name: 'BATTERY_COOLDOWN_MINUTES', default: '180', description: 'Cooldown para alertas de bateria baixa' },
    { name: 'DASHBOARD_USERS_JSON', default: '[]', description: 'JSON array com emails e papéis dashboard (admin/viewer)' },
  ];
}

export default {
  DEFAULT_CONFIG,
  getConfig,
  getRequiredEnvVars,
  getOptionalEnvVars,
};

export { getConfig };
