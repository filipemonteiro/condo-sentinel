// filepath: src/state.js
/**
 * Gerenciamento de estado dos dispositivos
 * Estado isolado por device no KV
 */

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
    lastApiFaultRecoveryAt: 0,
    lastApiFaultReason: null,
    batteryLowAlertActive: false,
    lastBatteryLowAlertAt: 0,
    alarmActive: false,
    lastAlarmAt: 0,
    lastAlarmRecoveryAt: 0,
    lastReading: null,
  };
}

const DASHBOARD_RUNTIME_CONFIG_KEY = 'dashboard:runtime:config';
const DASHBOARD_USER_ROLES_KEY = 'dashboard:runtime:user-roles';

export async function loadDashboardRuntimeConfig(env) {
  const raw = await env.STATE.get(DASHBOARD_RUNTIME_CONFIG_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('Dashboard runtime config corrompida ou inválida.');
    return null;
  }
}

export async function saveDashboardRuntimeConfig(env, config) {
  if (!config || typeof config !== 'object') return false;
  const next = JSON.stringify(config);
  const current = await env.STATE.get(DASHBOARD_RUNTIME_CONFIG_KEY);
  if (current === next) return false;
  await env.STATE.put(DASHBOARD_RUNTIME_CONFIG_KEY, next);
  return true;
}

export async function loadDashboardUserMappings(env) {
  const raw = await env.STATE.get(DASHBOARD_USER_ROLES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn('Dashboard user mappings corrompidos ou inválidos.');
    return [];
  }
}

export async function saveDashboardUserMappings(env, users) {
  if (!Array.isArray(users)) return false;
  const next = JSON.stringify(users);
  const current = await env.STATE.get(DASHBOARD_USER_ROLES_KEY);
  if (current === next) return false;
  await env.STATE.put(DASHBOARD_USER_ROLES_KEY, next);
  return true;
}

/**
 * Carrega estado de um device específico, com migração se necessário.
 * @param {object|null} legacyDevices - Se fornecido, usa este mapa para migração em vez de reler o KV global.
 */
export async function loadDeviceState(env, deviceId, legacyDevices = null) {
  const key = `state:device:${deviceId}`;
  let raw = await env.STATE.get(key);

  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      console.warn("Estado corrompido para device, usando padrão. ID omitido por segurança.");
    }
  }

  // Caminho rápido: caller forneceu o mapa legado já carregado (evita leitura extra de KV)
  if (legacyDevices !== null) {
    if (legacyDevices && legacyDevices[deviceId]) {
      const migrated = legacyDevices[deviceId];
      await saveDeviceState(env, deviceId, migrated);
      console.log("Migrado estado legado para device. ID omitido por segurança.");
      return migrated;
    }
    return null;
  }

  // Fallback: tentar migrar do estado global (se existir) — apenas quando legacyDevices não é fornecido
  const globalKey = "condo_automation_state";
  const globalRaw = await env.STATE.get(globalKey);
  if (globalRaw) {
    try {
      const globalState = JSON.parse(globalRaw);
      if (globalState.devices && globalState.devices[deviceId]) {
        const migrated = globalState.devices[deviceId];
        await saveDeviceState(env, deviceId, migrated);
        console.log("Migrado estado legado para device. ID omitido por segurança.");
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
 * Carrega estados de todos os devices.
 * @param {object|null} legacyDevices - Se fornecido, passado para loadDeviceState para evitar leituras duplicadas de KV.
 */
export async function loadAllDeviceStates(env, devices, legacyDevices = null) {
  const states = {};
  for (const device of devices) {
    states[device.id] = await loadDeviceState(env, device.id, legacyDevices) || createDefaultDeviceState(device);
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
    pendingNotifications: [],
    integrations: {},
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

export function mergeDeviceStateDefaults(existing) {
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
    lastApiFaultRecoveryAt: 0,
    lastApiFaultReason: null,
    batteryLowAlertActive: false,
    lastBatteryLowAlertAt: 0,
    alarmActive: false,
    lastAlarmAt: 0,
    lastAlarmRecoveryAt: 0,
    lastSeenAt: 0,
    lastBatchIsOnline: null,
    lastBatchInfo: null,
    lastReading: null,
    ...(existing || {}),
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
