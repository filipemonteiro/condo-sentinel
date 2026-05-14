import test from 'node:test';
import assert from 'node:assert/strict';

import { getConfig, normalizeDashboardRuntimeConfig } from '../src/config.js';
import { applyRuntimeDeviceConfig } from '../src/devices.js';

function makeEnv(runtimeConfig = null) {
  return {
    DASHBOARD_TITLE: 'Title from env',
    DASHBOARD_STALE_AFTER_MINUTES: '45',
    COOLDOWN_MINUTES: '90',
    BATTERY_THRESHOLD_PERCENT: '25',
    STATE: {
      async get(key) {
        if (key === 'dashboard:runtime:config' && runtimeConfig) {
          return JSON.stringify(runtimeConfig);
        }
        return null;
      },
    },
  };
}

test('runtime config from KV has priority over environment and defaults', async () => {
  const cfg = await getConfig(makeEnv({
    DASHBOARD_TITLE: 'Title from KV',
    DASHBOARD_STALE_AFTER_MINUTES: 10,
    COOLDOWN_MINUTES: 15,
    BATTERY_THRESHOLD_PERCENT: 30,
  }));

  assert.equal(cfg.dashboardTitle, 'Title from KV');
  assert.equal(cfg.dashboardStaleAfterMinutes, 10);
  assert.equal(cfg.defaultCooldownMs, 15 * 60_000);
  assert.equal(cfg.batteryThresholdPercent, 30);
});

test('environment config is used when runtime config is absent', async () => {
  const cfg = await getConfig(makeEnv());

  assert.equal(cfg.dashboardTitle, 'Title from env');
  assert.equal(cfg.dashboardStaleAfterMinutes, 45);
  assert.equal(cfg.defaultCooldownMs, 90 * 60_000);
  assert.equal(cfg.batteryThresholdPercent, 25);
});

test('normalizes only editable dashboard and device runtime fields', () => {
  assert.deepEqual(
    normalizeDashboardRuntimeConfig({
      DASHBOARD_TITLE: 'Safe title',
      DASHBOARD_ACCESS_TOKEN: 'must-not-persist',
      CLIENT_SECRET: 'must-not-persist',
      COOLDOWN_MINUTES: '20',
      devices: {
        'device-test': {
          thresholdPercent: '35',
          levelCode: 'must-not-persist',
        },
      },
    }),
    {
      DASHBOARD_TITLE: 'Safe title',
      COOLDOWN_MINUTES: 20,
      devices: {
        'device-test': {
          thresholdPercent: 35,
        },
      },
    }
  );
});

test('runtime device config overrides registry config by role and id', () => {
  const device = {
    id: 'device-test',
    role: 'tank_a',
    thresholdPercent: 20,
    cooldownMinutes: 60,
  };

  assert.deepEqual(
    applyRuntimeDeviceConfig(device, {
      deviceConfigs: {
        tank_a: { thresholdPercent: 30, cooldownMinutes: 90 },
        'device-test': { thresholdPercent: 40 },
      },
    }),
    {
      id: 'device-test',
      role: 'tank_a',
      thresholdPercent: 40,
      cooldownMinutes: 90,
    }
  );
});
