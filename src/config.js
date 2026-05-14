// filepath: src/config.js
/**
 * Configurações e variáveis de ambiente do worker
 * Todas as variáveis necessárias para o sistema
 */

import { toInt, toBool, parseJsonEnv } from './utils.js';
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
  DASHBOARD_TITLE: 'Condo Sentinel',
  BATTERY_THRESHOLD_PERCENT: 20,
  BATTERY_COOLDOWN_MINUTES: 180,
};

/**
 * Retorna a configuração processada a partir das variáveis de ambiente
 */
async function getConfig(env) {
  const runtimeConfig = await loadDashboardRuntimeConfig(env);
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...(runtimeConfig || {}),
    DASHBOARD_STALE_AFTER_MINUTES: env.DASHBOARD_STALE_AFTER_MINUTES ?? (runtimeConfig?.DASHBOARD_STALE_AFTER_MINUTES ?? DEFAULT_CONFIG.DASHBOARD_STALE_AFTER_MINUTES),
    DASHBOARD_TITLE: env.DASHBOARD_TITLE ?? (runtimeConfig?.DASHBOARD_TITLE ?? DEFAULT_CONFIG.DASHBOARD_TITLE),
    BATTERY_THRESHOLD_PERCENT: env.BATTERY_THRESHOLD_PERCENT ?? (runtimeConfig?.BATTERY_THRESHOLD_PERCENT ?? DEFAULT_CONFIG.BATTERY_THRESHOLD_PERCENT),
    BATTERY_COOLDOWN_MINUTES: env.BATTERY_COOLDOWN_MINUTES ?? (runtimeConfig?.BATTERY_COOLDOWN_MINUTES ?? DEFAULT_CONFIG.BATTERY_COOLDOWN_MINUTES),
  };

  return {
    dryRun: toBool(env.DRY_RUN, mergedConfig.DRY_RUN),
    logFullPayload: toBool(env.LOG_FULL_PAYLOAD, mergedConfig.LOG_FULL_PAYLOAD),
    defaultCooldownMs: toInt(env.COOLDOWN_MINUTES, mergedConfig.COOLDOWN_MINUTES) * 60 * 1000,
    defaultOfflineCooldownMs: toInt(env.OFFLINE_COOLDOWN_MINUTES, mergedConfig.OFFLINE_COOLDOWN_MINUTES) * 60 * 1000,
    defaultFaultCooldownMs: toInt(env.SENSOR_COOLDOWN_MINUTES, mergedConfig.SENSOR_COOLDOWN_MINUTES) * 60 * 1000,
    batteryThresholdPercent: toInt(env.BATTERY_THRESHOLD_PERCENT, mergedConfig.BATTERY_THRESHOLD_PERCENT),
    batteryCooldownMs: toInt(env.BATTERY_COOLDOWN_MINUTES, mergedConfig.BATTERY_COOLDOWN_MINUTES) * 60 * 1000,
    historyMinIntervalMinutes: toInt(env.HISTORY_MIN_INTERVAL_MINUTES, mergedConfig.HISTORY_MIN_INTERVAL_MINUTES),
    historyMinDeltaPercent: toInt(env.HISTORY_MIN_DELTA_PERCENT, mergedConfig.HISTORY_MIN_DELTA_PERCENT),
    historyMaxPoints: toInt(env.HISTORY_MAX_POINTS, mergedConfig.HISTORY_MAX_POINTS),
    dashboardStaleAfterMinutes: toInt(env.DASHBOARD_STALE_AFTER_MINUTES, mergedConfig.DASHBOARD_STALE_AFTER_MINUTES),
    dashboardTitle: env.DASHBOARD_TITLE || mergedConfig.DASHBOARD_TITLE,
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