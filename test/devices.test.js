import test from 'node:test';
import assert from 'node:assert/strict';

import {
  inspectDevice,
  inspectGenericStatusDevice,
  inspectWaterLevelSensor,
  processDevices,
} from '../src/devices.js';

const cfg = {
  defaultCooldownMs: 30 * 60_000,
  defaultFaultCooldownMs: 30 * 60_000,
  defaultOfflineCooldownMs: 30 * 60_000,
  logFullPayload: false,
};

function makeEnv() {
  const store = new Map();

  return {
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    STATE: {
      async get(key) {
        return store.get(key) ?? null;
      },
      async put(key, value) {
        store.set(key, value);
      },
    },
  };
}

function withFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => handler(String(url), options);

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function statusPayload(entries) {
  return {
    success: true,
    result: entries.map(([code, value]) => ({ code, value })),
  };
}

function waterStatus(percent, state = 'normal') {
  return statusPayload([
    ['liquid_level_percent', percent],
    ['liquid_state', state],
    ['battery_percentage', 90],
  ]);
}

test('respects low level alert cooldown before notifying again', async () => {
  const env = makeEnv();
  const device = {
    id: 'water-sensor-test',
    name: 'Reservoir sensor',
    type: 'water_level_sensor',
    thresholdPercent: 20,
    cooldownMinutes: 30,
    minConsecutiveBreaches: 2,
  };
  const dState = {
    lowLevelAlertActive: false,
    lastLowLevelAlertAt: 10 * 60_000,
    breachCount: 1,
  };
  const notifications = [];

  await withFetch(
    () => jsonResponse(waterStatus(10)),
    async () => {
      await inspectWaterLevelSensor(
        env,
        'access-token',
        device,
        dState,
        cfg,
        20 * 60_000,
        notifications
      );

      assert.equal(notifications.length, 0);
      assert.equal(dState.lowLevelAlertActive, false);

      await inspectWaterLevelSensor(
        env,
        'access-token',
        device,
        dState,
        cfg,
        41 * 60_000,
        notifications
      );
    }
  );

  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /nível do sensor/);
  assert.equal(dState.lowLevelAlertActive, true);
  assert.equal(dState.lastLowLevelAlertAt, 41 * 60_000);
});

test('sends low level recovery notification when level normalizes', async () => {
  const env = makeEnv();
  const device = {
    id: 'water-sensor-test',
    name: 'Reservoir sensor',
    type: 'water_level_sensor',
    thresholdPercent: 20,
    recoveryMarginPercent: 10,
  };
  const dState = {
    lowLevelAlertActive: true,
    breachCount: 4,
  };
  const notifications = [];

  await withFetch(
    () => jsonResponse(waterStatus(35)),
    () => inspectWaterLevelSensor(env, 'access-token', device, dState, cfg, 60_000, notifications)
  );

  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /normalizou em 35%/);
  assert.equal(dState.lowLevelAlertActive, false);
  assert.equal(dState.breachCount, 0);
  assert.equal(dState.lastRecoveryAt, 60_000);
});

test('tracks offline alert and online recovery notification', async () => {
  const env = makeEnv();
  const device = {
    id: 'valve-test',
    name: 'Main valve',
    type: 'valve',
  };
  const dState = {};
  const notifications = [];

  const offlineResult = await inspectDevice(
    env,
    'access-token',
    device,
    { id: device.id, is_online: false },
    dState,
    cfg,
    60_000,
    notifications
  );

  assert.equal(offlineResult.online, false);
  assert.equal(dState.offlineAlertActive, true);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /offline ou indisponível/);

  await withFetch(
    () => jsonResponse(statusPayload([['switch_1', true]])),
    () => inspectDevice(
      env,
      'access-token',
      device,
      { id: device.id, is_online: true },
      dState,
      cfg,
      120_000,
      notifications
    )
  );

  assert.equal(dState.offlineAlertActive, false);
  assert.equal(dState.lastOnlineRecoveryAt, 120_000);
  assert.match(notifications[1], /voltou a ficar online/);
});

test('sends alarm resolution notification for generic status devices', async () => {
  const env = makeEnv();
  const device = {
    id: 'gas-sensor-test',
    name: 'Gas sensor',
    type: 'gas_sensor',
  };
  const dState = {
    alarmActive: true,
  };
  const notifications = [];

  await withFetch(
    () => jsonResponse(statusPayload([['gas_alarm', 'normal'], ['battery_percentage', 80]])),
    () => inspectGenericStatusDevice(
      env,
      'access-token',
      device,
      dState,
      cfg,
      90_000,
      notifications,
      {
        alarmCodes: ['gas_alarm'],
        batteryCodes: ['battery_percentage'],
      }
    )
  );

  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /saiu do estado de alarme/);
  assert.equal(dState.alarmActive, false);
  assert.equal(dState.lastAlarmRecoveryAt, 90_000);
});

test('single Tuya status failure records API fault without creating false sensor alarms', async () => {
  const env = makeEnv();
  const device = {
    id: 'water-sensor-test',
    name: 'Reservoir sensor',
    role: 'tank_a',
    type: 'water_level_sensor',
  };
  const deviceStates = {
    [device.id]: {
      lowLevelAlertActive: false,
      sensorFaultActive: false,
      alarmActive: false,
      apiFaultActive: false,
    },
  };
  const notifications = [];
  const context = {
    devicesById: {},
    devicesByRole: {},
    readingsByRole: {},
    availabilityByRole: {},
    batchInfoById: {},
  };

  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withFetch(
      (url) => {
        if (url.includes('/v2.0/cloud/thing/batch')) {
          return jsonResponse({
            success: true,
            result: [{ id: device.id, is_online: true }],
          });
        }

        return jsonResponse({ success: false, result: null });
      },
      () => processDevices(
        env,
        'access-token',
        [device],
        deviceStates,
        cfg,
        120_000,
        notifications,
        context
      )
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /Falha ao consultar/);
  assert.equal(deviceStates[device.id].apiFaultActive, true);
  assert.equal(deviceStates[device.id].lowLevelAlertActive, false);
  assert.equal(deviceStates[device.id].sensorFaultActive, false);
  assert.equal(deviceStates[device.id].alarmActive, false);
  assert.equal(context.readingsByRole.tank_a, undefined);
});

test('consecutive Tuya status failures keep error state and respect fault cooldown', async () => {
  const env = makeEnv();
  const device = {
    id: 'water-sensor-test',
    name: 'Reservoir sensor',
    type: 'water_level_sensor',
    faultCooldownMinutes: 30,
  };
  const deviceStates = {
    [device.id]: {
      apiFaultActive: false,
    },
  };
  const notifications = [];

  const originalConsoleError = console.error;
  console.error = () => {};

  const run = (now) => withFetch(
    (url) => {
      if (url.includes('/v2.0/cloud/thing/batch')) {
        return jsonResponse({
          success: true,
          result: [{ id: device.id, is_online: true }],
        });
      }

      return jsonResponse({ success: false, result: null });
    },
    () => processDevices(
      env,
      'access-token',
      [device],
      deviceStates,
      cfg,
      now,
      notifications,
      {
        devicesById: {},
        devicesByRole: {},
        readingsByRole: {},
        availabilityByRole: {},
        batchInfoById: {},
      }
    )
  );

  try {
    await run(60_000);
    await run(10 * 60_000);
    await run(32 * 60_000);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(deviceStates[device.id].apiFaultActive, true);
  assert.equal(deviceStates[device.id].lastApiFaultAlertAt, 32 * 60_000);
  assert.equal(notifications.length, 2);
  assert.match(notifications[0], /Falha ao consultar/);
  assert.match(notifications[1], /Falha ao consultar/);
});

test('Tuya batch chunk failure records API faults only for affected devices', async () => {
  const env = makeEnv();
  const devices = Array.from({ length: 21 }, (_, index) => ({
    id: `valve-test-${index}`,
    name: `Valve ${index}`,
    role: `valve_${index}`,
    type: 'valve',
  }));
  const deviceStates = Object.fromEntries(devices.map(device => [
    device.id,
    {
      apiFaultActive: false,
      offlineAlertActive: false,
    },
  ]));
  const notifications = [];
  const context = {
    devicesById: {},
    devicesByRole: {},
    readingsByRole: {},
    availabilityByRole: {},
    batchInfoById: {},
  };
  let batchCalls = 0;

  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withFetch(
      (url) => {
        if (url.includes('/v2.0/cloud/thing/batch')) {
          batchCalls += 1;
          if (batchCalls === 1) {
            return jsonResponse({
              success: true,
              result: devices.slice(0, 20).map(device => ({
                id: device.id,
                is_online: true,
              })),
            });
          }

          return jsonResponse({
            success: false,
            result: null,
            code: 'temporary_error',
          });
        }

        if (url.includes('/v1.0/devices/')) {
          return jsonResponse(statusPayload([['switch_1', true]]));
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
      () => processDevices(
        env,
        'access-token',
        devices,
        deviceStates,
        cfg,
        120_000,
        notifications,
        context
      )
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(batchCalls, 2);
  assert.equal(deviceStates['valve-test-0'].apiFaultActive, false);
  assert.equal(deviceStates['valve-test-0'].lastReading.currentValue, true);
  assert.equal(context.availabilityByRole.valve_0.online, true);

  assert.equal(deviceStates['valve-test-20'].apiFaultActive, true);
  assert.equal(deviceStates['valve-test-20'].lastApiFaultReason, 'batch');
  assert.equal(deviceStates['valve-test-20'].offlineAlertActive, false);
  assert.equal(context.availabilityByRole.valve_20, undefined);
  assert.deepEqual(context.batchInfoFailedDeviceIds, ['valve-test-20']);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /Falha ao consultar/);
});
