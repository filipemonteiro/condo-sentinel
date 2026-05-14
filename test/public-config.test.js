import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('wrangler example does not ship runtime secrets or token placeholders', async () => {
  const content = await readFile(new URL('../wrangler.example.toml', import.meta.url), 'utf8');

  assert.doesNotMatch(content, /^\[.*vars\]/m);

  for (const name of runtimeVariableNames()) {
    assert.doesNotMatch(content, new RegExp(name));
  }

  assert.match(content, /keep_vars = true/);
});

test('deploy workflow blocks runtime vars from generated wrangler config', async () => {
  const content = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

  assert.match(content, /Guard runtime secrets/);
  assert.match(content, /wrangler deploy --keep-vars/);

  for (const name of runtimeVariableNames()) {
    assert.match(content, new RegExp(name));
  }
});

function runtimeVariableNames() {
  return [
    'CLIENT_ID',
    'CLIENT_SECRET',
    'TUYA_BASE',
    'TUYA_ACCESS_TOKEN',
    'TUYA_CLIENT_ID',
    'TUYA_CLIENT_SECRET',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'DASHBOARD_ACCESS_TOKEN',
    'DASHBOARD_USERS_JSON',
    'DEVICE_REGISTRY_JSON',
    'AUTOMATIONS_JSON',
    'APP_NAME',
    'DASHBOARD_TITLE',
    'DASHBOARD_SESSION_TIMEOUT_MINUTES',
    'DASHBOARD_STALE_AFTER_MINUTES',
    'DRY_RUN',
    'LOG_FULL_PAYLOAD',
    'COOLDOWN_MINUTES',
    'OFFLINE_COOLDOWN_MINUTES',
    'SENSOR_COOLDOWN_MINUTES',
    'BATTERY_THRESHOLD_PERCENT',
    'BATTERY_COOLDOWN_MINUTES',
    'HISTORY_MAX_POINTS',
    'HISTORY_MIN_INTERVAL_MINUTES',
    'HISTORY_MIN_DELTA_PERCENT',
  ];
}
