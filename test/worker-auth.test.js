import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';
import { escapeHtmlText, renderDashboardHtml } from '../src/dashboard.js';

const env = {
  DASHBOARD_ACCESS_TOKEN: 'secret-token',
  DEVICE_REGISTRY_JSON: '[]',
  AUTOMATIONS_JSON: '[]',
  DASHBOARD_STALE_AFTER_MINUTES: '30',
  STATE: {
    async get() {
      return null;
    },
  },
};

const historyEnv = {
  ...env,
  STATE: {
    async get(key) {
      if (key === 'history:device:device-test') {
        return JSON.stringify([{ ts: 1000, type: 'water_level_sensor', online: true, percent: 80 }]);
      }
      return null;
    },
  },
};

function makeState(initial = {}) {
  const store = new Map(Object.entries(initial));

  return {
    store,
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

test('rejects API requests without bearer token', async () => {
  const res = await worker.fetch(new Request('https://example.com/api/status'), env, {});

  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Unauthorized' });
});

test('rejects API requests when dashboard token is not configured', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/status'),
    { ...env, DASHBOARD_ACCESS_TOKEN: '' },
    {}
  );

  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'DASHBOARD_ACCESS_TOKEN is not configured.' });
});

test('allows API requests with valid bearer token', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/status', {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    }),
    env,
    {}
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');

  const payload = await res.json();
  assert.equal(payload.summary.totalDevices, 0);
});

test('history API returns points envelope expected by dashboard charts', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/history?device=device-test', {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    }),
    historyEnv,
    {}
  );

  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    deviceId: 'device-test',
    points: [{ ts: 1000, type: 'water_level_sensor', online: true, percent: 80 }],
  });
});

test('dashboard context returns admin role from Cloudflare Access email', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/dashboard-context', {
      headers: {
        Authorization: 'Bearer secret-token',
        'Cf-Access-Authenticated-User-Email': 'admin@example.test',
      },
    }),
    {
      ...env,
      DASHBOARD_USERS_JSON: '[{"email":"admin@example.test","role":"admin"}]',
    },
    {}
  );

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.currentUser.role, 'admin');
  assert.equal(payload.users.length, 1);
});

test('dashboard context exposes editable non-sensitive config for admin', async () => {
  const state = makeState({
    'dashboard:runtime:config': JSON.stringify({
      COOLDOWN_MINUTES: 15,
      devices: {
        'water-test': {
          thresholdPercent: 35,
        },
      },
    }),
  });

  const res = await worker.fetch(
    new Request('https://example.com/api/dashboard-context', {
      headers: {
        Authorization: 'Bearer secret-token',
        'Cf-Access-Authenticated-User-Email': 'admin@example.test',
      },
    }),
    {
      ...env,
      ...state,
      DASHBOARD_USERS_JSON: '[{"email":"admin@example.test","role":"admin"}]',
      DEVICE_REGISTRY_JSON: JSON.stringify([
        {
          id: 'water-test',
          name: 'Water test',
          role: 'tank_test',
          type: 'water_level_sensor',
          thresholdPercent: 20,
        },
      ]),
    },
    {}
  );

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.config.COOLDOWN_MINUTES, 15);
  assert.equal(payload.devices[0].config.thresholdPercent, 35);
  assert.equal(payload.devices[0].config.cooldownMinutes, 15);
  assert.equal(payload.config.DASHBOARD_ACCESS_TOKEN, undefined);
});

test('dashboard context exposes device fields according to device type', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/dashboard-context', {
      headers: {
        Authorization: 'Bearer secret-token',
        'Cf-Access-Authenticated-User-Email': 'admin@example.test',
      },
    }),
    {
      ...env,
      DASHBOARD_USERS_JSON: '[{"email":"admin@example.test","role":"admin"}]',
      DEVICE_REGISTRY_JSON: JSON.stringify([
        { id: 'water-test', role: 'tank_test', type: 'water_level_sensor' },
        { id: 'gas-test', role: 'gas_test', type: 'gas_sensor' },
        { id: 'valve-test', role: 'valve_test', type: 'valve' },
      ]),
    },
    {}
  );

  assert.equal(res.status, 200);
  const payload = await res.json();
  const byId = Object.fromEntries(payload.devices.map(device => [device.id, device]));

  assert.equal(byId['water-test'].config.thresholdPercent, 20);
  assert.equal(byId['water-test'].config.batteryThresholdPercent, 20);
  assert.equal(byId['gas-test'].config.thresholdPercent, undefined);
  assert.equal(byId['gas-test'].config.batteryThresholdPercent, 20);
  assert.equal(byId['valve-test'].config.thresholdPercent, undefined);
  assert.equal(byId['valve-test'].config.batteryThresholdPercent, undefined);
  assert.equal(byId['valve-test'].config.offlineCooldownMinutes, 180);
});

test('viewer dashboard context does not expose user list or device config', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/dashboard-context', {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    }),
    {
      ...env,
      DASHBOARD_USERS_JSON: '[{"email":"admin@example.test","role":"admin"}]',
      DEVICE_REGISTRY_JSON: '[{"id":"water-test","type":"water_level_sensor"}]',
    },
    {}
  );

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.deepEqual(payload.users, []);
  assert.deepEqual(payload.devices, []);
});

test('saving dashboard config does not clear saved users when users are omitted', async () => {
  const state = makeState({
    'dashboard:runtime:user-roles': JSON.stringify([
      { email: 'admin@example.test', role: 'admin' },
    ]),
  });

  const res = await worker.fetch(
    new Request('https://example.com/api/dashboard-context', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Cf-Access-Authenticated-User-Email': 'admin@example.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ config: { DASHBOARD_TITLE: 'Updated title' } }),
    }),
    {
      ...env,
      ...state,
    },
    {}
  );

  assert.equal(res.status, 200);
  assert.deepEqual(
    JSON.parse(state.store.get('dashboard:runtime:user-roles')),
    [{ email: 'admin@example.test', role: 'admin' }]
  );
  assert.deepEqual(
    JSON.parse(state.store.get('dashboard:runtime:config')),
    { DASHBOARD_TITLE: 'Updated title' }
  );
});

test('dashboard includes session timeout and token form shell', () => {
  const html = renderDashboardHtml({ sessionTimeoutMinutes: 45 });

  assert.match(html, /const SESSION_TIMEOUT_MS = 45 \* 60 \* 1000;/);
  assert.match(html, /id="auth-form"/);
  assert.match(html, /sessionStorage/);
  assert.match(html, /Authorization: 'Bearer '/);
});

test('dashboard response includes defensive browser headers', async () => {
  const res = await worker.fetch(new Request('https://example.com/dashboard'), env, {});

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(res.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(res.headers.get('Content-Security-Policy'), /https:\/\/cdn\.jsdelivr\.net/);
});

test('dashboard escapes configured title before rendering HTML', () => {
  assert.equal(
    escapeHtmlText('<script>alert("x")</script>\''),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;'
  );

  const html = renderDashboardHtml({
    dashboardTitle: '<img src=x onerror=alert("x")>',
  });

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(&quot;x&quot;\)&gt;/);
  assert.match(html, /replace\(\/'\/g, '&#39;'\)/);
});
