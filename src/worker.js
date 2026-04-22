export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCheck(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(`${url.origin}/dashboard`, 302);
    }

    if (url.pathname === "/api/status") {
      const payload = await buildDashboardStatus(env);
      return jsonResponse(payload);
    }

    if (url.pathname === "/api/history") {
      const deviceId = url.searchParams.get("device");
      const history = await getDeviceHistory(env, deviceId);
      return jsonResponse({
        deviceId,
        points: history,
      });
    }

    if (url.pathname === "/dashboard") {
      return htmlResponse(renderDashboardHtml());
    }

    return new Response("Not found", { status: 404 });
  }
};

async function handleCheck(env) {
  const now = Date.now();

  const cfg = {
    dryRun: toBool(env.DRY_RUN, true),
    logFullPayload: toBool(env.LOG_FULL_PAYLOAD, false),
    defaultCooldownMs: toInt(env.COOLDOWN_MINUTES, 60) * 60 * 1000,
    defaultOfflineCooldownMs: toInt(env.OFFLINE_COOLDOWN_MINUTES, 180) * 60 * 1000,
    defaultFaultCooldownMs: toInt(env.SENSOR_COOLDOWN_MINUTES, 60) * 60 * 1000,
  };

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

  const state = await loadState(env);
  const accessToken = await getTuyaToken(env);

  const notifications = [];
  const context = {
    devicesById: {},
    devicesByRole: {},
    readingsByRole: {},
    availabilityByRole: {},
    batchInfoById: {},
  };

  const batchInfo = await getAllDevicesBatchInfo(
    env,
    accessToken,
    enabledDevices.map(device => device.id),
    cfg.logFullPayload
  );

  const batchMap = buildBatchDeviceMap(batchInfo);
  context.batchInfoById = batchMap;

  for (const device of enabledDevices) {
    context.devicesById[device.id] = device;
    if (device.role) {
      context.devicesByRole[device.role] = device;
    }

    state.devices[device.id] = mergeDeviceStateDefaults(
      state.devices[device.id],
      device.type
    );

    try {
      const result = await inspectDevice(
        env,
        accessToken,
        device,
        batchMap[device.id],
        state,
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
      console.error(`Erro processando device ${device.name || device.id}:`, stringifyError(err));

      const dState = state.devices[device.id];
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

  if (Array.isArray(automations) && automations.length > 0) {
    await evaluateAutomations({
      automations,
      state,
      now,
      notifications,
      context,
    });
  }

  if (notifications.length > 0) {
    const message = notifications.join("\n\n");
    await sendTelegramMessage(env, message, cfg.dryRun);
  }

  await saveState(env, state);

  console.log("Execução concluída.", {
    deviceCount: enabledDevices.length,
    notifications: notifications.length,
    automationCount: Array.isArray(automations) ? automations.length : 0,
  });
}

async function inspectDevice(env, accessToken, device, batchDeviceInfo, state, cfg, now, notifications) {
  const dState = state.devices[device.id];

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

async function inspectWaterLevelSensor(env, accessToken, device, dState, cfg, now, notifications) {
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

async function inspectGenericStatusDevice(
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

async function inspectValve(env, accessToken, device, dState, cfg, now, notifications) {
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

async function evaluateAutomations({ automations, state, now, notifications, context }) {
  for (const rule of automations) {
    if (!rule || rule.enabled === false || !rule.type) {
      continue;
    }

    const ruleKey = getAutomationKey(rule);

    state.automations[ruleKey] = mergeAutomationStateDefaults(
      state.automations[ruleKey]
    );

    const aState = state.automations[ruleKey];

    try {
      switch (rule.type) {
        case "water_reserve_control":
          evaluateWaterReserveControl(rule, aState, context, now, notifications);
          break;
        default:
          console.warn(`Tipo de automação não suportado ainda: ${rule.type}`);
      }
    } catch (err) {
      console.error(`Erro avaliando automação ${rule.id || "(sem id)"}`, stringifyError(err));
    }
  }
}

function evaluateWaterReserveControl(rule, aState, context, now, notifications) {
  const sourceRoles = Array.isArray(rule.sourceRoles) ? rule.sourceRoles : [];
  const valveRole = rule.targetValveRole;
  const openForMinutes = toInt(rule?.action?.openForMinutes, 15);
  const allBelowPercent = toInt(rule?.trigger?.allBelowPercent, 20);
  const minConsecutiveChecks = toInt(rule?.trigger?.minConsecutiveChecks, 3);
  const cooldownMinutes = toInt(rule?.notify?.cooldownMinutes, 120);
  const cooldownMs = cooldownMinutes * 60 * 1000;

  if (sourceRoles.length === 0 || !valveRole) {
    return;
  }

  const readings = [];
  for (const role of sourceRoles) {
    const r = context.readingsByRole[role];
    if (!r || r.type !== "water_level_sensor" || r.valid !== true || !Number.isFinite(r.percent)) {
      return;
    }
    readings.push({ role, reading: r });
  }

  const allBelow = readings.every(item => item.reading.percent <= allBelowPercent);

  if (allBelow) {
    aState.triggerCount = (aState.triggerCount || 0) + 1;
  } else {
    aState.triggerCount = 0;
    aState.plannedActionAlertActive = false;
    return;
  }

  const shouldAnnounce =
    !aState.plannedActionAlertActive &&
    aState.triggerCount >= minConsecutiveChecks &&
    now - (aState.lastPlannedActionAlertAt || 0) > cooldownMs;

  if (!shouldAnnounce) {
    return;
  }

  const levels = readings
    .map(item => `${item.role}: ${item.reading.percent}%`)
    .join(", ");

  notifications.push(
    `🤖 Automação prevista: no cenário atual (${levels}), a automação "${rule.name || rule.id || "sem nome"}" irá abrir em breve a válvula "${valveRole}" por ${openForMinutes} minuto(s) para apoiar o abastecimento. Nesta versão, a ação ainda não será executada automaticamente; apenas sinalizada.`
  );

  aState.plannedActionAlertActive = true;
  aState.lastPlannedActionAlertAt = now;
}

function getAutomationKey(rule) {
  if (rule.id) return rule.id;

  const type = rule.type || "unknown";
  const targetValveRole = rule.targetValveRole || "no_target";
  const sourceRoles = Array.isArray(rule.sourceRoles) ? rule.sourceRoles.join("_") : "no_sources";

  return `${type}__${targetValveRole}__${sourceRoles}`;
}

async function getAllDevicesBatchInfo(env, accessToken, deviceIds, logFullPayload = false) {
  const results = [];

  for (let i = 0; i < deviceIds.length; i += 20) {
    const chunk = deviceIds.slice(i, i + 20);
    const batch = await getTuyaDevicesBatchInfo(env, accessToken, chunk, logFullPayload);
    results.push(...batch);
  }

  return results;
}

async function getTuyaDevicesBatchInfo(env, accessToken, deviceIds, logFullPayload = false) {
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    return [];
  }

  const ids = deviceIds.slice(0, 20).join(",");
  const path = `/v2.0/cloud/thing/batch?device_ids=${encodeURIComponent(ids)}`;
  const method = "GET";
  const body = "";

  const signed = await buildTuyaSignedRequest(env, {
    method,
    path,
    body,
    accessToken,
  });

  const res = await fetch(`${env.TUYA_BASE}${path}`, {
    method,
    headers: signed.headers,
  });

  const data = await res.json();

  if (logFullPayload) {
    console.log("Tuya batch payload:", JSON.stringify(data));
  }

  if (!data.success || !Array.isArray(data.result)) {
    throw new Error(`Resposta inválida do batch da Tuya: ${JSON.stringify(data)}`);
  }

  return data.result;
}

function buildBatchDeviceMap(batchResult) {
  const map = {};
  for (const item of batchResult || []) {
    if (item && item.id) {
      map[item.id] = item;
    }
  }
  return map;
}

function sanitizeBatchInfo(info) {
  if (!info || typeof info !== "object") return null;

  return {
    id: info.id ?? null,
    name: info.name ?? null,
    custom_name: info.custom_name ?? null,
    product_name: info.product_name ?? null,
    category: info.category ?? null,
    is_online: info.is_online ?? null,
    update_time: info.update_time ?? null,
    active_time: info.active_time ?? null,
    time_zone: info.time_zone ?? null,
    ip: info.ip ?? null,
  };
}

async function getTuyaDeviceStatus(env, accessToken, deviceId, logFullPayload = false) {
  const path = `/v1.0/devices/${deviceId}/status`;
  const method = "GET";
  const body = "";

  const signed = await buildTuyaSignedRequest(env, {
    method,
    path,
    body,
    accessToken,
  });

  const res = await fetch(`${env.TUYA_BASE}${path}`, {
    method,
    headers: signed.headers,
  });

  const data = await res.json();

  if (logFullPayload) {
    console.log(`Tuya status payload [${deviceId}]:`, JSON.stringify(data));
  }

  if (!data.success || !Array.isArray(data.result)) {
    throw new Error(`Resposta inválida de status da Tuya para ${deviceId}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function appendDeviceHistory(env, device, reading, online, now = Date.now()) {
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
  const minIntervalMinutes = toInt(env.HISTORY_MIN_INTERVAL_MINUTES, 15);
  const minIntervalMs = minIntervalMinutes * 60 * 1000;
  const minDeltaPercent = toInt(env.HISTORY_MIN_DELTA_PERCENT, 2);

  const shouldWrite = shouldAppendHistoryPoint({
    device,
    last,
    next: point,
    minIntervalMs,
    minDeltaPercent,
  });

  if (!shouldWrite) return false;

  history.push(point);

  const maxPoints = toInt(env.HISTORY_MAX_POINTS, 288);
  if (history.length > maxPoints) {
    history = history.slice(-maxPoints);
  }

  await env.STATE.put(key, JSON.stringify(history));
  return true;
}

function shouldAppendHistoryPoint({ device, last, next, minIntervalMs, minDeltaPercent }) {
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

function buildHistoryPoint(device, reading, online, ts = Date.now()) {
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

async function buildDashboardStatus(env) {
  const state = await loadState(env);
  const devices = parseJsonEnv(env.DEVICE_REGISTRY_JSON, []);
  const automations = parseJsonEnv(env.AUTOMATIONS_JSON, []);
  const now = Date.now();
  const staleAfterMinutes = toInt(env.DASHBOARD_STALE_AFTER_MINUTES, 30);
  const staleAfterMs = staleAfterMinutes * 60 * 1000;

  const deviceViews = (Array.isArray(devices) ? devices : []).map(device => {
    const dState = state.devices?.[device.id] || {};
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
    automations: state.automations || {},
    generatedAt: now,
    staleAfterMinutes,
  };
}

async function getDeviceHistory(env, deviceId) {
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Karl Wilhelm - Dashboard de monitorias do Condomínio</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      background: #f4f6f8;
      color: #1f2937;
    }
    header {
      background: #0f172a;
      color: white;
      padding: 16px 20px;
    }
    main {
      padding: 20px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    .device-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 16px;
    }
    .muted {
      color: #6b7280;
      font-size: 14px;
    }
    .small {
      font-size: 12px;
      color: #6b7280;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 6px;
      margin-bottom: 6px;
    }
    .ok { background: #dcfce7; color: #166534; }
    .warn { background: #fef3c7; color: #92400e; }
    .bad { background: #fee2e2; color: #991b1b; }
    .neutral { background: #e5e7eb; color: #374151; }
    .info { background: #dbeafe; color: #1d4ed8; }
    canvas {
      margin-top: 12px;
      max-height: 180px;
    }
  </style>
</head>
<body>
  <header>
    <h1>IoT - Sensores e automações</h1>
    <div class="muted" style="color:#cbd5e1;">Visão atual dos dispositivos e histórico recente</div>
  </header>

  <main>
    <section id="summary" class="summary"></section>
    <section id="devices" class="device-grid"></section>
  </main>

  <script>
    const charts = {};

    function formatTs(ts) {
      if (!ts) return "-";
      return new Date(ts).toLocaleString("pt-BR");
    }

    function minutesAgo(ts) {
      if (!ts) return null;
      return Math.max(0, Math.floor((Date.now() - ts) / 60000));
    }

    function badge(label, cls) {
      return '<span class="badge ' + cls + '">' + label + '</span>';
    }

    async function loadStatus() {
      const res = await fetch('/api/status', { cache: 'no-store' });
      return res.json();
    }

    async function loadHistory(deviceId) {
      const res = await fetch('/api/history?device=' + encodeURIComponent(deviceId), { cache: 'no-store' });
      return res.json();
    }

    function card(title, value) {
      return '<div class="card"><div class="muted">' + title + '</div><div style="font-size:28px;font-weight:bold;margin-top:8px;">' + value + '</div></div>';
    }

    function renderSummary(summary) {
      const root = document.getElementById('summary');
      root.innerHTML = [
        card('Total de devices', summary.totalDevices),
        card('Online', summary.onlineDevices),
        card('Offline', summary.offlineDevices),
        card('Desatualizados', summary.staleDevices),
        card('Em alarme', summary.devicesInAlarm),
        card('Com falha', summary.devicesWithFault),
        card('Nível baixo', summary.devicesLowLevel),
      ].join('');
    }

    function deviceStatusBadges(device) {
      const items = [];

      items.push(device.online ? badge('Online', 'ok') : badge('Offline', 'bad'));

      if (device.stale) items.push(badge('Sem atualização recente', 'info'));
      if (device.lowLevelAlertActive) items.push(badge('Nível baixo', 'warn'));
      if (device.sensorFaultActive) items.push(badge('Leitura inválida', 'bad'));
      if (device.alarmActive) items.push(badge('Alarme', 'bad'));

      if (!device.stale && !device.lowLevelAlertActive && !device.sensorFaultActive && !device.alarmActive) {
        items.push(badge('Sem alerta ativo', 'neutral'));
      }

      return items.join('');
    }

    function getReadingFreshnessText(device) {
      const mins = minutesAgo(device.readingUpdatedAt);
      if (mins === null) return 'Sem leitura registrada';
      if (mins === 0) return 'Leitura atualizada há menos de 1 min';
      return 'Última leitura válida há ' + mins + ' min';
    }

    function renderDeviceCard(device) {
      let extra = '';

      if (device.type === 'water_level_sensor') {
        extra = \`
          <div><strong>Nível:</strong> \${device.lastReading?.percent ?? '-' }%</div>
          <div><strong>Estado:</strong> \${device.lastReading?.liquidState ?? '-'}</div>
          <div><strong>Bateria:</strong> \${device.lastReading?.battery ?? '-' }%</div>
          <div><strong>Breach count:</strong> \${device.breachCount ?? 0}</div>
          <div class="small" style="margin-top:6px;">\${getReadingFreshnessText(device)}</div>
          <canvas id="chart-\${device.id}"></canvas>
        \`;
      } else if (device.type === 'gas_sensor' || device.type === 'water_leak_sensor') {
        extra = \`
          <div><strong>Alarme:</strong> \${device.lastReading?.alarmValue ?? '-'}</div>
          <div><strong>Bateria:</strong> \${device.lastReading?.battery ?? '-' }%</div>
          <div class="small" style="margin-top:6px;">\${getReadingFreshnessText(device)}</div>
          <canvas id="chart-\${device.id}"></canvas>
        \`;
      } else if (device.type === 'valve') {
        extra = \`
          <div><strong>Status:</strong> \${device.lastReading?.currentValue ?? '-'}</div>
          <div class="small" style="margin-top:6px;">\${getReadingFreshnessText(device)}</div>
        \`;
      } else {
        extra = '<div class="muted">Tipo ainda sem visual específico.</div>';
      }

      return \`
        <div class="card">
          <h3 style="margin-top:0;">\${device.name}</h3>
          <div class="muted">\${device.role || '-'} • \${device.type}</div>
          <div style="margin:10px 0;">\${deviceStatusBadges(device)}</div>
          <div><strong>Última checagem do worker:</strong> \${formatTs(device.lastSeenAt)}</div>
          <div><strong>Leitura registrada:</strong> \${formatTs(device.readingUpdatedAt)}</div>
          \${extra}
        </div>
      \`;
    }

    async function renderDevices(devices) {
      const root = document.getElementById('devices');
      root.innerHTML = devices.map(renderDeviceCard).join('');

      for (const device of devices) {
        if (device.type === 'water_level_sensor' || device.type === 'gas_sensor' || device.type === 'water_leak_sensor') {
          const historyPayload = await loadHistory(device.id);
          renderChart(device, historyPayload.points || []);
        }
      }
    }

    function buildWaterDataset(points) {
      const labels = points.map(p => new Date(p.ts).toLocaleTimeString('pt-BR'));
      const values = points.map(p => (typeof p.percent === 'number' ? p.percent : null));

      return {
        labels,
        datasets: [
          {
            label: 'Nível %',
            data: values,
            spanGaps: true,
            tension: 0.2
          }
        ]
      };
    }

    function buildBinaryDataset(points, label) {
      const labels = points.map(p => new Date(p.ts).toLocaleTimeString('pt-BR'));
      const values = points.map(p => p.alarm ? 1 : 0);

      return {
        labels,
        datasets: [
          {
            label,
            data: values,
            spanGaps: true,
            stepped: true
          }
        ]
      };
    }

    function buildPointStyles(points) {
      return points.map(p => p.online === false ? 6 : 3);
    }

    function buildPointRadius(points) {
      return points.map(p => p.online === false ? 5 : 2);
    }

    function renderChart(device, points) {
      const el = document.getElementById('chart-' + device.id);
      if (!el) return;

      let chartData;
      let yConfig = {};

      if (device.type === 'water_level_sensor') {
        chartData = buildWaterDataset(points);
        chartData.datasets[0].pointStyle = buildPointStyles(points);
        chartData.datasets[0].pointRadius = buildPointRadius(points);
        yConfig = {
          min: 0,
          max: 100
        };
      } else {
        chartData = buildBinaryDataset(points, 'Alarme');
        chartData.datasets[0].pointStyle = buildPointStyles(points);
        chartData.datasets[0].pointRadius = buildPointRadius(points);
        yConfig = {
          min: 0,
          max: 1,
          ticks: {
            stepSize: 1
          }
        };
      }

      if (charts[device.id]) {
        charts[device.id].destroy();
      }

      charts[device.id] = new Chart(el, {
        type: 'line',
        data: chartData,
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            tooltip: {
              callbacks: {
                afterLabel: (ctx) => {
                  const point = points[ctx.dataIndex];
                  if (!point) return '';
                  const meta = [];
                  if (point.online === false) meta.push('Device offline neste ponto');
                  if (point.valid === false) meta.push('Leitura inválida');
                  return meta.join(' • ');
                }
              }
            }
          },
          scales: {
            y: yConfig
          }
        }
      });
    }

    async function refresh() {
      try {
        const payload = await loadStatus();
        renderSummary(payload.summary);
        await renderDevices(payload.devices);
      } catch (err) {
        console.error('Erro ao atualizar dashboard:', err);
      }
    }

    refresh();
    setInterval(refresh, 60000);
  </script>
</body>
</html>`;
}

function getInvalidWaterLevelReadingReason(reading) {
  if (!Number.isFinite(reading.percent)) {
    return "percentual ausente ou não numérico";
  }

  if (reading.percent < 0 || reading.percent > 100) {
    return `percentual fora da faixa (${reading.percent}%)`;
  }

  if (typeof reading.state === "string" && reading.state.startsWith("err_")) {
    return reading.state;
  }

  return null;
}

function isAlarmLikeValue(value) {
  if (value === true) return true;
  if (value === 1) return true;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return [
      "alarm",
      "warn",
      "warning",
      "on",
      "true",
      "detected",
      "gas_alarm",
      "leak",
      "leak_alarm",
      "presence",
      "triggered",
    ].includes(normalized);
  }

  return false;
}

async function getTuyaToken(env) {
  const path = `/v1.0/token?grant_type=1`;
  const method = "GET";
  const body = "";

  const signed = await buildTuyaSignedRequest(env, {
    method,
    path,
    body,
    accessToken: null,
  });

  const res = await fetch(`${env.TUYA_BASE}${path}`, {
    method,
    headers: signed.headers,
  });

  const data = await res.json();

  if (!data.success || !data.result?.access_token) {
    throw new Error(`Falha ao obter token da Tuya: ${JSON.stringify(data)}`);
  }

  return data.result.access_token;
}

async function buildTuyaSignedRequest(env, { method, path, body = "", accessToken = null }) {
  const clientId = env.CLIENT_ID;
  const clientSecret = env.CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("CLIENT_ID ou CLIENT_SECRET não configurados.");
  }

  const t = String(Date.now());
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const bodyHash = await sha256Hex(body || "");
  const stringToSign = [method.toUpperCase(), bodyHash, "", path].join("\n");

  const signStr = accessToken
    ? `${clientId}${accessToken}${t}${nonce}${stringToSign}`
    : `${clientId}${t}${nonce}${stringToSign}`;

  const sign = await hmacSha256Upper(clientSecret, signStr);

  const headers = {
    client_id: clientId,
    t,
    nonce,
    sign_method: "HMAC-SHA256",
    sign,
    mode: "cors",
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers.access_token = accessToken;
  }

  return { headers };
}

async function sendTelegramMessage(env, message, dryRun = false) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN não configurado.");
  }
  if (!env.TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_CHAT_ID não configurado.");
  }

  if (dryRun) {
    console.log("DRY_RUN ativo. Mensagem Telegram não enviada.", {
      chatId: env.TELEGRAM_CHAT_ID,
      message,
    });
    return;
  }

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || data.ok !== true) {
    throw new Error(`Erro ao enviar mensagem no Telegram: ${JSON.stringify(data)}`);
  }

  console.log("Mensagem enviada ao Telegram com sucesso.");
}

async function loadState(env) {
  const raw = await env.STATE.get("condo_automation_state");

  if (!raw) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      devices: {
        ...defaultState().devices,
        ...(parsed.devices || {}),
      },
      automations: {
        ...defaultState().automations,
        ...(parsed.automations || {}),
      },
    };
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return {
    devices: {},
    automations: {},
  };
}

async function saveState(env, state) {
  const key = "condo_automation_state";
  const next = JSON.stringify(state);
  const current = await env.STATE.get(key);

  if (current === next) {
    return false;
  }

  await env.STATE.put(key, next);
  return true;
}

function mergeDeviceStateDefaults(existing, type) {
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

function mergeAutomationStateDefaults(existing) {
  return {
    triggerCount: 0,
    plannedActionAlertActive: false,
    lastPlannedActionAlertAt: 0,
    ...(existing || {}),
  };
}

function parseJsonEnv(value, fallback) {
  if (!value) return fallback;

  if (typeof value === "object") {
    return value;
  }

  if (!String(value).trim()) return fallback;

  try {
    return JSON.parse(value);
  } catch (err) {
    console.error("Erro ao fazer parse do JSON de env:", value);
    console.error("Detalhe:", stringifyError(err));
    return fallback;
  }
}

function statusArrayToMap(resultArray) {
  return Object.fromEntries((resultArray || []).map(item => [item.code, item.value]));
}

function toInt(value, fallback) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function stringifyError(err) {
  if (!err) return "erro desconhecido";
  if (err.stack) return err.stack;
  if (err.message) return err.message;
  return String(err);
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Upper(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}