// filepath: src/history.js
/**
 * Gerenciamento de histórico dos dispositivos
 */

import { toInt, isAlarmLikeValue } from './utils.js';

/**
 * Append ponto de histórico para um device
 */
export async function appendDeviceHistory(env, device, reading, online, now = Date.now(), cfg = null) {
  if (!device?.id) return false;

  const point = buildHistoryPoint(device, reading, online, now);
  if (!point) return false;

  const key = `history:device:${device.id}`;
  const raw = await env.STATE.get(key);

  let history = [];
  if (raw) {
    try {
      history = JSON.parse(raw);
      if (!Array.isArray(history)) history = [];
    } catch {
      history = [];
    }
  }

  const last = history[history.length - 1];
  const minIntervalMinutes = cfg?.historyMinIntervalMinutes ?? toInt(env.HISTORY_MIN_INTERVAL_MINUTES, 15);
  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const minDeltaPercent = cfg?.historyMinDeltaPercent ?? toInt(env.HISTORY_MIN_DELTA_PERCENT, 2);

  const shouldWrite = shouldAppendHistoryPoint({
    device,
    last,
    next: point,
    minIntervalMs,
    minDeltaPercent,
  });

  if (!shouldWrite) return false;

  history.push(point);

  const maxPoints = cfg?.historyMaxPoints ?? toInt(env.HISTORY_MAX_POINTS, 288);
  if (history.length > maxPoints) {
    history = history.slice(-maxPoints);
  }

  await env.STATE.put(key, JSON.stringify(history));
  return true;
}

/**
 * Decide se deve append novo ponto de histórico
 */
export function shouldAppendHistoryPoint({ device, last, next, minIntervalMs, minDeltaPercent }) {
  if (!next) return false;
  if (!last) return true;

  const elapsedMs =
    Number.isFinite(next.ts) && Number.isFinite(last.ts)
      ? next.ts - last.ts
      : Number.POSITIVE_INFINITY;

  const intervalReached = elapsedMs >= minIntervalMs;
  const onlineChanged = last.online !== next.online;

  if (onlineChanged) return true;

  switch (device.type) {
    case "water_level_sensor": {
      const validChanged = last.valid !== next.valid;
      const stateChanged = last.state !== next.state;

      const lastPercent = Number.isFinite(last.percent) ? last.percent : null;
      const nextPercent = Number.isFinite(next.percent) ? next.percent : null;

      const percentChanged =
        lastPercent !== null &&
        nextPercent !== null &&
        Math.abs(nextPercent - lastPercent) >= minDeltaPercent;

      const percentNullnessChanged =
        (lastPercent === null) !== (nextPercent === null);

      return (
        validChanged ||
        stateChanged ||
        percentChanged ||
        percentNullnessChanged ||
        intervalReached
      );
    }

    case "gas_sensor":
    case "water_leak_sensor": {
      const alarmChanged = last.alarm !== next.alarm;
      const alarmValueChanged = last.alarmValue !== next.alarmValue;
      return alarmChanged || alarmValueChanged || intervalReached;
    }

    case "valve": {
      const valueChanged = last.currentValue !== next.currentValue;
      return valueChanged || intervalReached;
    }

    default:
      return intervalReached;
  }
}

/**
 * Constrói ponto de histórico
 */
export function buildHistoryPoint(device, reading, online, ts = Date.now()) {
  if (device.type === "water_level_sensor") {
    return {
      ts,
      type: device.type,
      online: !!online,
      percent: Number.isFinite(reading?.percent) ? reading.percent : null,
      state: reading?.state ?? null,
      battery: Number.isFinite(reading?.battery) ? reading.battery : null,
      valid: reading?.valid ?? null,
    };
  }

  if (device.type === "gas_sensor" || device.type === "water_leak_sensor") {
    return {
      ts,
      type: device.type,
      online: !!online,
      alarm: isAlarmLikeValue(reading?.alarmValue),
      alarmValue: reading?.alarmValue ?? null,
      battery: Number.isFinite(reading?.battery) ? reading.battery : null,
    };
  }

  if (device.type === "valve") {
    return {
      ts,
      type: device.type,
      online: !!online,
      currentValue: reading?.currentValue ?? null,
      statusCode: reading?.statusCode ?? null,
    };
  }

  return null;
}

/**
 * Obtém histórico de um device
 */
export async function getDeviceHistory(env, deviceId) {
  if (!deviceId) return [];

  const key = `history:device:${deviceId}`;
  const raw = await env.STATE.get(key);

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
