// filepath: src/devices.js
/**
 * Lógica de inspeção e gerenciamento de dispositivos
 */

import { getTuyaDeviceStatus, buildBatchDeviceMap } from './tuya.js';
import { toInt, toNumber, isAlarmLikeValue, getInvalidWaterLevelReadingReason, sanitizeBatchInfo } from './utils.js';

/**
 * Processa todos os devices habilitados
 */
export async function processDevices(env, accessToken, enabledDevices, deviceStates, cfg, now, notifications, context) {
  // Carrega batch info de todos os devices
  const deviceIds = enabledDevices.map(device => device.id);
  const batchInfo = await getAllDevicesBatchInfo(env, accessToken, deviceIds, cfg.logFullPayload);
  const batchMap = buildBatchDeviceMap(batchInfo);
  context.batchInfoById = batchMap;

  for (const device of enabledDevices) {
    context.devicesById[device.id] = device;
    if (device.role) {
      context.devicesByRole[device.role] = device;
    }

    // Garante que o estado existe com defaults
    deviceStates[device.id] = { ...deviceStates[device.id] };

    try {
      const result = await inspectDevice(
        env,
        accessToken,
        device,
        batchMap[device.id],
        deviceStates[device.id],
        cfg,
        now,
        notifications
      );

      context.availabilityByRole[device.role || device.id] = {
        online: result.online,
        batchIsOnline: result.batchIsOnline,
      };

      if (result.reading) {
        context.readingsByRole[device.role || device.id] = result.reading;
      }

      await appendDeviceHistory(env, device, result.reading, result.online, now);
    } catch (err) {
      console.error(`Erro processando device ${device.name || device.id}:`, err);

      const dState = deviceStates[device.id];
      const cooldownMs = device.faultCooldownMinutes
        ? device.faultCooldownMinutes * 60 * 1000
        : cfg.defaultFaultCooldownMs;

      const shouldNotify =
        !dState.apiFaultActive ||
        now - (dState.lastApiFaultAlertAt || 0) > cooldownMs;

      if (shouldNotify) {
        notifications.push(
          `⚠️ Falha ao consultar o device "${device.name || device.id}". Verifique integração, conectividade, credenciais ou assinatura da API da Tuya.`
        );
        dState.apiFaultActive = true;
        dState.lastApiFaultAlertAt = now;
      }
    }
  }
}

/**
 * Inspeta um device específico
 */
export async function inspectDevice(env, accessToken, device, batchDeviceInfo, dState, cfg, now, notifications) {
  const isOnline = batchDeviceInfo?.is_online === true;

  dState.lastSeenAt = now;
  dState.lastBatchIsOnline = batchDeviceInfo?.is_online ?? null;
  dState.lastBatchInfo = sanitizeBatchInfo(batchDeviceInfo);
  dState.apiFaultActive = false;

  const offlineCooldownMs = device.offlineCooldownMinutes
    ? device.offlineCooldownMinutes * 60 * 1000
    : cfg.defaultOfflineCooldownMs;

  if (!isOnline) {
    const shouldNotifyOffline =
      !dState.offlineAlertActive ||
      now - (dState.lastOfflineAlertAt || 0) > offlineCooldownMs;

    if (shouldNotifyOffline) {
      notifications.push(
        `⚠️ O device "${device.name || device.id}" está offline ou indisponível no momento.`
      );
      dState.offlineAlertActive = true;
      dState.lastOfflineAlertAt = now;
    }

    return {
      online: false,
      batchIsOnline: batchDeviceInfo?.is_online ?? null,
      reading: null,
    };
  }

  if (dState.offlineAlertActive) {
    notifications.push(
      `✅ O device "${device.name || device.id}" voltou a ficar online.`
    );
    dState.offlineAlertActive = false;
    dState.lastOnlineRecoveryAt = now;
  }

  let reading = null;

  switch (device.type) {
    case "water_level_sensor":
      reading = await inspectWaterLevelSensor(
        env,
        accessToken,
        device,
        dState,
        cfg,
        now,
        notifications
      );
      break;

    case "gas_sensor":
      reading = await inspectGenericStatusDevice(
        env,
        accessToken,
        device,
        dState,
        cfg,
        now,
        notifications,
        {
          alarmCodes: ["gas_alarm", "alarm", "gas_state"],
          batteryCodes: ["battery_percentage", "battery"],
        }
      );
      break;

    case "water_leak_sensor":
      reading = await inspectGenericStatusDevice(
        env,
        accessToken,
        device,
        dState,
        cfg,
        now,
        notifications,
        {
          alarmCodes: ["watersensor_state", "water_state", "leak_state", "alarm"],
          batteryCodes: ["battery_percentage", "battery"],
        }
      );
      break;

    case "valve":
      reading = await inspectValve(
        env,
        accessToken,
        device,
        dState,
        cfg,
        now,
        notifications
      );
      break;

    default:
      console.warn(`Tipo de device não suportado ainda: ${device.type}`);
      break;
  }

  return {
    online: true,
    batchIsOnline: batchDeviceInfo?.is_online ?? null,
    reading,
  };
}

/**
 * Inspeta sensor de nível de água
 */
export async function inspectWaterLevelSensor(env, accessToken, device, dState, cfg, now, notifications) {
  const payload = await getTuyaDeviceStatus(env, accessToken, device.id, cfg.logFullPayload);
  const map = statusArrayToMap(payload.result);

  const reading = {
    type: "water_level_sensor",
    state: map.liquid_state,
    depth: toNumber(map.liquid_depth),
    battery: toNumber(map.battery_percentage),
    maxSet: toNumber(map.max_set),
    minSet: toNumber(map.mini_set),
    installationHeight: toNumber(map.installation_height),
    liquidDepthMax: toNumber(map.liquid_depth_max),
    percent: toNumber(map[device.levelCode || "liquid_level_percent"]),
  };

  const invalidReason = getInvalidWaterLevelReadingReason(reading);

  const faultCooldownMs = device.faultCooldownMinutes
    ? device.faultCooldownMinutes * 60 * 1000
    : cfg.defaultFaultCooldownMs;

  if (invalidReason) {
    const shouldNotifyFault =
      !dState.sensorFaultActive ||
      now - (dState.lastSensorFaultAlertAt || 0) > faultCooldownMs;

    if (shouldNotifyFault) {
      notifications.push(
        `⚠️ O sensor "${device.name || device.id}" está com leitura inválida (${invalidReason}). Verifique instalação, posição, obstruções ou calibração.`
      );
      dState.sensorFaultActive = true;
      dState.lastSensorFaultAlertAt = now;
    }

    dState.lastReading = {
      percent: Number.isFinite(reading.percent) ? reading.percent : null,
      liquidState: reading.state,
      battery: reading.battery,
      valid: false,
      invalidReason,
      readingUpdatedAt: now,
    };

    return {
      ...reading,
      valid: false,
      invalidReason,
      online: true,
    };
  }

  if (dState.sensorFaultActive) {
    notifications.push(
      `✅ A leitura do sensor "${device.name || device.id}" foi restabelecida. Nível atual: ${reading.percent}%.`
    );
    dState.sensorFaultActive = false;
    dState.lastSensorRecoveryAt = now;
  }

  dState.lastReading = {
    percent: reading.percent,
    liquidState: reading.state,
    battery: reading.battery,
    valid: true,
    readingUpdatedAt: now,
  };

  const threshold = toInt(device.thresholdPercent, 20);
  const recoveryMargin = toInt(device.recoveryMarginPercent, 10);
  const minConsecutiveBreaches = toInt(device.minConsecutiveBreaches, 2);
  const lowLevelCooldownMs =
    toInt(device.cooldownMinutes, cfg.defaultCooldownMs / 60000) * 60 * 1000;

  if (reading.percent <= threshold) {
    dState.breachCount = (dState.breachCount || 0) + 1;
  } else {
    dState.breachCount = 0;
  }

  const shouldSendLowLevelAlert =
    !dState.lowLevelAlertActive &&
    dState.breachCount >= minConsecutiveBreaches &&
    now - (dState.lastLowLevelAlertAt || 0) > lowLevelCooldownMs;

  if (shouldSendLowLevelAlert) {
    notifications.push(
      `⚠️ O nível do sensor "${device.name || device.id}" está em ${reading.percent}%, abaixo do limite configurado de ${threshold}%.`
    );
    dState.lowLevelAlertActive = true;
    dState.lastLowLevelAlertAt = now;
  }

  const recoveryThreshold = threshold + recoveryMargin;
  const shouldSendRecovery =
    dState.lowLevelAlertActive && reading.percent >= recoveryThreshold;

  if (shouldSendRecovery) {
    notifications.push(
      `✅ O nível do sensor "${device.name || device.id}" normalizou em ${reading.percent}%.`
    );
    dState.lowLevelAlertActive = false;
    dState.lastRecoveryAt = now;
    dState.breachCount = 0;
  }

  return {
    ...reading,
    valid: true,
    online: true,
    threshold,
    breachCount: dState.breachCount || 0,
    lowLevelAlertActive: dState.lowLevelAlertActive || false,
  };
}

/**
 * Inspeta device genérico de status (gas, vazamento)
 */
export async function inspectGenericStatusDevice(
  env,
  accessToken,
  device,
  dState,
  cfg,
  now,
  notifications,
  options = {}
) {
  const payload = await getTuyaDeviceStatus(env, accessToken, device.id, cfg.logFullPayload);
  const map = statusArrayToMap(payload.result);

  const alarmCodes = Array.isArray(options.alarmCodes) ? options.alarmCodes : [];
  const batteryCodes = Array.isArray(options.batteryCodes) ? options.batteryCodes : [];

  let alarmValue = null;
  for (const code of alarmCodes) {
    if (code in map) {
      alarmValue = map[code];
      break;
    }
  }

  let batteryValue = null;
  for (const code of batteryCodes) {
    if (code in map) {
      batteryValue = toNumber(map[code]);
      if (Number.isFinite(batteryValue)) break;
    }
  }

  const reading = {
    type: device.type,
    alarmValue,
    battery: batteryValue,
    raw: map,
    online: true,
  };

  const isAlarm = isAlarmLikeValue(alarmValue);

  if (isAlarm && !dState.alarmActive) {
    notifications.push(
      `🚨 O device "${device.name || device.id}" entrou em alarme. Valor reportado: ${String(alarmValue)}.`
    );
    dState.alarmActive = true;
    dState.lastAlarmAt = now;
  }

  if (!isAlarm && dState.alarmActive) {
    notifications.push(
      `✅ O device "${device.name || device.id}" saiu do estado de alarme.`
    );
    dState.alarmActive = false;
    dState.lastAlarmRecoveryAt = now;
  }

  dState.lastReading = {
    alarmValue,
    battery: batteryValue,
    readingUpdatedAt: now,
  };

  return reading;
}

/**
 * Inspeta válvula
 */
export async function inspectValve(env, accessToken, device, dState, cfg, now, notifications) {
  const payload = await getTuyaDeviceStatus(env, accessToken, device.id, cfg.logFullPayload);
  const map = statusArrayToMap(payload.result);

  const statusCode = device.statusCode || "switch_1";
  const currentValue = map[statusCode];

  const reading = {
    type: "valve",
    statusCode,
    currentValue,
    raw: map,
    online: true,
  };

  dState.lastReading = {
    currentValue,
    statusCode,
    readingUpdatedAt: now,
  };

  return reading;
}

// Funções auxiliares para statusArrayToMap
function statusArrayToMap(resultArray) {
  return Object.fromEntries((resultArray || []).map(item => [item.code, item.value]));
}