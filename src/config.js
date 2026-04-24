// filepath: src/config.js
/**
 * Configurações e variáveis de ambiente do worker
 * Todas as variáveis necessárias para o sistema
 */

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
};

/**
 * Retorna a configuração processada a partir das variáveis de ambiente
 */
function getConfig(env) {
  return {
    dryRun: toBool(env.DRY_RUN, DEFAULT_CONFIG.DRY_RUN),
    logFullPayload: toBool(env.LOG_FULL_PAYLOAD, DEFAULT_CONFIG.LOG_FULL_PAYLOAD),
    defaultCooldownMs: toInt(env.COOLDOWN_MINUTES, DEFAULT_CONFIG.COOLDOWN_MINUTES) * 60 * 1000,
    defaultOfflineCooldownMs: toInt(env.OFFLINE_COOLDOWN_MINUTES, DEFAULT_CONFIG.OFFLINE_COOLDOWN_MINUTES) * 60 * 1000,
    defaultFaultCooldownMs: toInt(env.SENSOR_COOLDOWN_MINUTES, DEFAULT_CONFIG.SENSOR_COOLDOWN_MINUTES) * 60 * 1000,
    historyMinIntervalMinutes: toInt(env.HISTORY_MIN_INTERVAL_MINUTES, DEFAULT_CONFIG.HISTORY_MIN_INTERVAL_MINUTES),
    historyMinDeltaPercent: toInt(env.HISTORY_MIN_DELTA_PERCENT, DEFAULT_CONFIG.HISTORY_MIN_DELTA_PERCENT),
    historyMaxPoints: toInt(env.HISTORY_MAX_POINTS, DEFAULT_CONFIG.HISTORY_MAX_POINTS),
    dashboardStaleAfterMinutes: toInt(env.DASHBOARD_STALE_AFTER_MINUTES, DEFAULT_CONFIG.DASHBOARD_STALE_AFTER_MINUTES),
  };
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
  ];
}

// Utils (toInt, toBool, etc) são importadas de utils.js
function toInt(value, fallback) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  if (!String(value).trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error("Erro ao fazer parse do JSON de env:", value);
    return fallback;
  }
}

export default {
  DEFAULT_CONFIG,
  getConfig,
  getRequiredEnvVars,
  getOptionalEnvVars,
  toInt,
  toBool,
  parseJsonEnv,
};