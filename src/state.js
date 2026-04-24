// filepath: src/state.js
/**
 * Gerenciamento de estado dos dispositivos
 * Estado isolado por device no KV
 */

import { toInt } from './utils.js';

/**
 * Cria estado padrão para um device
 */
export function createDefaultDeviceState(device) {
  return {
    id: device.id,
    type: device.type,
    lastSeenAt: 0,
    lastBatchIsOnline: null,
    lastBatchInfo: null,
    offlineAlertActive: false,
    lastOfflineAlertAt: 0,
    lastOnlineRecoveryAt: 0,
    sensorFaultActive: false,
    lastSensorFaultAlertAt: 0,
    lastSensorRecoveryAt: 0,
    lowLevelAlertActive: false,
    lastLowLevelAlertAt: 0,
    lastRecoveryAt: 0,
    breachCount: 0,
    apiFaultActive: false,
    lastApiFaultAlertAt: 0,
    alarmActive: false,
    lastAlarmAt: 0,
    lastAlarmRecoveryAt: 0,
    lastReading: null,
  };
}

/**
 * Carrega estado de um device específico, com migração se necessário
 */
export async function loadDeviceState(env, deviceId) {
  const key = `state:device:${deviceId}`;
  let raw = await env.STATE.get(key);
  
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      console.warn(`Estado corrompido para device ${deviceId}, usando padrão.`);
    }
  }
  
  // Fallback: tentar migrar do estado global (se existir)
  const globalKey = "condo_automation_state";
  const globalRaw = await env.STATE.get(globalKey);
  if (globalRaw) {
    try {
      const globalState = JSON.parse(globalRaw);
      if (globalState.devices && globalState.devices[deviceId]) {
        const migrated = globalState.devices[deviceId];
        await saveDeviceState(env, deviceId, migrated);
        console.log(`Migrado estado para device ${deviceId}.`);
        return migrated;
      }
    } catch {
      console.warn("Erro ao migrar estado global.");
    }
  }
  
  return null;
}

/**
 * Salva estado de um device específico
 */
export async function saveDeviceState(env, deviceId, state) {
  if (!state) return;
  const key = `state:device:${deviceId}`;
  const next = JSON.stringify(state);
  const current = await env.STATE.get(key);
  
  if (current === next) return;
  
  await env.STATE.put(key, next);
}

/**
 * Carrega estados de todos os devices
 */
export async function loadAllDeviceStates(env, devices) {
  const states = {};
  for (const device of devices) {
    states[device.id] = await loadDeviceState(env, device.id) || createDefaultDeviceState(device);
  }
  return states;
}

/**
 * Salva estados de todos os devices
 */
export async function saveAllDeviceStates(env, deviceStates) {
  for (const [deviceId, state] of Object.entries(deviceStates)) {
    await saveDeviceState(env, deviceId, state);
  }
}

/**
 * Gerenciamento de estado global (para automações)
 */
export async function loadGlobalState(env) {
  const raw = await env.STATE.get("condo_automation_state");
  if (!raw) {
    return defaultGlobalState();
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaultGlobalState(),
      ...parsed,
      automations: {
        ...defaultGlobalState().automations,
        ...(parsed.automations || {}),
      },
    };
  } catch {
    return defaultGlobalState();
  }
}

export function defaultGlobalState() {
  return {
    devices: {},
    automations: {},
  };
}

export async function saveGlobalState(env, state) {
  const key = "condo_automation_state";
  const next = JSON.stringify(state);
  const current = await env.STATE.get(key);
  if (current === next) return false;
  await env.STATE.put(key, next);
  return true;
}

export function mergeDeviceStateDefaults(existing, type) {
  return {
    offlineAlertActive: false,
    lastOfflineAlertAt: 0,
    lastOnlineRecoveryAt: 0,
    sensorFaultActive: false,
    lastSensorFaultAlertAt: 0,
    lastSensorRecoveryAt: 0,
    lowLevelAlertActive: false,
    lastLowLevelAlertAt: 0,
    lastRecoveryAt: 0,
    breachCount: 0,
    apiFaultActive: false,
    lastApiFaultAlertAt: 0,
    alarmActive: false,
    lastAlarmAt: 0,
    lastAlarmRecoveryAt: 0,
    lastSeenAt: 0,
    lastBatchIsOnline: null,
    lastBatchInfo: null,
    lastReading: null,
    ...(existing || {}),
    _type: type,
  };
}

export function mergeAutomationStateDefaults(existing) {
  return {
    triggerCount: 0,
    plannedActionAlertActive: false,
    lastPlannedActionAlertAt: 0,
    ...(existing || {}),
  };
}