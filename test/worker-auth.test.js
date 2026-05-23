import test from 'node:test';
import assert from 'node:assert/strict';

import worker, { handleCheck } from '../src/worker.js';
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
  DEVICE_REGISTRY_JSON: '[{"id":"device-test","type":"water_level_sensor"}]',
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

test('history API rejects unknown device ids', async () => {
  const res = await worker.fetch(
    new Request('https://example.com/api/history?device=unknown-device', {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    }),
    historyEnv,
    {}
  );

  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Unknown device' });
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

test('status API exposes Tuya API fault state', async () => {
  const state = makeState({
    'state:device:water-test': JSON.stringify({
      id: 'water-test',
      type: 'water_level_sensor',
      lastBatchIsOnline: true,
      apiFaultActive: true,
      lastApiFaultReason: 'status',
      lastApiFaultAlertAt: 120_000,
      lastReading: null,
    }),
  });

  const res = await worker.fetch(
    new Request('https://example.com/api/status', {
      headers: {
        Authorization: 'Bearer secret-token',
      },
    }),
    {
      ...env,
      ...state,
      DEVICE_REGISTRY_JSON: '[{"id":"water-test","type":"water_level_sensor"}]',
    },
    {}
  );

  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.devices[0].apiFaultActive, true);
  assert.equal(payload.devices[0].lastApiFaultReason, 'status');
  assert.equal(payload.devices[0].lastApiFaultAlertAt, 120_000);
  assert.equal(payload.summary.devicesWithFault, 1);
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

test('dashboard includes navigable on-demand history controls', () => {
  const html = renderDashboardHtml({ sessionTimeoutMinutes: 30 });

  assert.match(html, /id="history"/);
  assert.match(html, /id="history-device"/);
  assert.match(html, /id="history-range"/);
  assert.match(html, /id="history-bucket"/);
  assert.match(html, /data-section="history"/);
  assert.match(html, /historyCache/);
});

test('dashboard config form includes client-side range validation messages', () => {
  const html = renderDashboardHtml({ sessionTimeoutMinutes: 30 });

  assert.match(html, /BATTERY_THRESHOLD_PERCENT: \{ min: 0, max: 100/);
  assert.match(html, /thresholdPercent: \{ min: 0, max: 100/);
  assert.match(html, /Configuração não salva:/);
  assert.match(html, /precisa ser menor ou igual a/);
  assert.match(html, /Configuração não salva por completo/);
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

test('scheduled check persists device state even when Telegram send fails', async () => {
  const state = makeState({
    'tuya:access_token': JSON.stringify({
      token: 'cached-access-token',
      expiresAt: Date.now() + 600_000,
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };

  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'valve-test', is_online: false }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      return new Response(JSON.stringify({
        ok: false,
        error_code: 500,
        description: 'telegram unavailable',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await assert.rejects(() => handleCheck(runEnv), /Erro ao enviar mensagem no Telegram/);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }

  const savedDeviceState = JSON.parse(state.store.get('state:device:valve-test'));
  assert.equal(savedDeviceState.offlineAlertActive, true);
  assert.equal(savedDeviceState.lastBatchIsOnline, false);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(Array.isArray(savedGlobalState.pendingNotifications), true);
  assert.equal(savedGlobalState.pendingNotifications.length, 1);
  assert.match(savedGlobalState.pendingNotifications[0].message, /offline ou indisponível/);
  assert.equal(typeof savedGlobalState.pendingNotifications[0].lastAttemptAt, 'number');
  assert.equal(typeof savedGlobalState.pendingNotifications[0].nextAttemptAt, 'number');
});

test('scheduled check sends system notification when Tuya token cannot be obtained', async () => {
  const state = makeState();
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    AUTOMATIONS_JSON: JSON.stringify([
      {
        id: 'reserve',
        type: 'water_reserve_control',
        sourceRoles: ['tank_a'],
        targetValveRole: 'valve_main',
        trigger: {
          allBelowPercent: 20,
          minConsecutiveChecks: 1,
        },
      },
    ]),
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: false,
        code: 'auth_failed',
        msg: 'invalid credentials',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /Falha ao obter token da Tuya/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.deepEqual(savedGlobalState.pendingNotifications, []);
  assert.equal(savedGlobalState.integrations.tuya.tokenFaultActive, true);
  assert.equal(typeof savedGlobalState.integrations.tuya.lastTokenFaultAlertAt, 'number');
  assert.deepEqual(savedGlobalState.automations, {});
});

test('scheduled check respects Tuya token fault cooldown', async () => {
  const state = makeState({
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [],
      integrations: {
        tuya: {
          tokenFaultActive: true,
          lastTokenFaultAlertAt: Date.now(),
        },
      },
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    SENSOR_COOLDOWN_MINUTES: '60',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: false,
        code: 'auth_failed',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }

  assert.equal(sentMessages.length, 0);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.integrations.tuya.tokenFaultActive, true);
});

test('scheduled check does not retry pending Telegram notifications before cooldown', async () => {
  const now = Date.now();
  const state = makeState({
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        {
          message: '⚠️ Falha ao obter token da Tuya. Verifique credenciais, conectividade ou assinatura da API antes da próxima verificação.',
          lastAttemptAt: now,
          nextAttemptAt: now + 60 * 60_000,
        },
      ],
      integrations: {
        tuya: {
          tokenFaultActive: true,
          lastTokenFaultAlertAt: now,
        },
      },
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    SENSOR_COOLDOWN_MINUTES: '60',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => {};
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: false,
        code: 'auth_failed',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }

  assert.equal(sentMessages.length, 0);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 1);
  assert.match(savedGlobalState.pendingNotifications[0].message, /Falha ao obter token da Tuya/);
});

test('scheduled check sends Tuya token recovery notification once authentication returns', async () => {
  const state = makeState({
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [],
      integrations: {
        tuya: {
          tokenFaultActive: true,
          lastTokenFaultAlertAt: 120_000,
        },
      },
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'valve-test', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /autenticação com a Tuya foi restabelecida/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.integrations.tuya.tokenFaultActive, false);
});

test('scheduled check removes pending device offline notification when device recovers', async () => {
  const now = Date.now();
  const state = makeState({
    'state:device:valve-test': JSON.stringify({
      id: 'valve-test',
      lastSeenAt: now - 300_000,
      lastBatchIsOnline: false,
      offlineAlertActive: true,
      lastOfflineAlertAt: now - 300_000,
    }),
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        {
          message: '⚠️ O device "Main valve" está offline ou indisponível no momento.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
      ],
      integrations: {},
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'valve-test', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /voltou a ficar online/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 0);
});

test('scheduled check keeps unrelated pending notifications when device recovery occurs', async () => {
  const now = Date.now();
  const state = makeState({
    'state:device:valve-test': JSON.stringify({
      id: 'valve-test',
      lastSeenAt: now - 300_000,
      lastBatchIsOnline: false,
      offlineAlertActive: true,
      lastOfflineAlertAt: now - 300_000,
    }),
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        {
          message: '⚠️ O device "Main valve" está offline ou indisponível no momento.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
        {
          message: '⚠️ Alerta genérico não relacionado.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
      ],
      integrations: {},
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'valve-test', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /voltou a ficar online/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 1);
  assert.match(savedGlobalState.pendingNotifications[0].message, /Alerta genérico não relacionado/);
});

test('scheduled check removes pending Tuya token fault notification when authentication recovers', async () => {
  const now = Date.now();
  const state = makeState({
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        {
          message: '⚠️ Falha ao obter token da Tuya. Verifique credenciais, conectividade ou assinatura da API antes da próxima verificação.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
      ],
      integrations: {
        tuya: {
          tokenFaultActive: true,
          lastTokenFaultAlertAt: now - 120_000,
        },
      },
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'valve-test', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /autenticação com a Tuya foi restabelecida/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 0);
  assert.equal(savedGlobalState.integrations.tuya.tokenFaultActive, false);
});

test('scheduled check keeps unrelated pending notifications when Tuya authentication recovers', async () => {
  const now = Date.now();
  const state = makeState({
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        {
          message: '⚠️ Falha ao obter token da Tuya. Verifique credenciais, conectividade ou assinatura da API antes da próxima verificação.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
        {
          message: '⚠️ O device "Main valve" está offline ou indisponível no momento.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 120_000,
        },
      ],
      integrations: {
        tuya: {
          tokenFaultActive: true,
          lastTokenFaultAlertAt: now - 120_000,
        },
      },
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'valve-test', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /autenticação com a Tuya foi restabelecida/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 1);
  assert.match(savedGlobalState.pendingNotifications[0].message, /O device "Main valve" está offline ou indisponível/);
});

test('scheduled check removes pending Tuya token string notification on recovery', async () => {
  const state = makeState({
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        '⚠️ Falha ao obter token da Tuya. Verifique credenciais, conectividade ou assinatura da API antes da próxima verificação.',
      ],
      integrations: {
        tuya: {
          tokenFaultActive: true,
          lastTokenFaultAlertAt: 120_000,
        },
      },
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'valve-test',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'valve-test', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /autenticação com a Tuya foi restabelecida/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 0);
});

test('scheduled check removes pending device offline notification for the recovered device only', async () => {
  const now = Date.now();
  const state = makeState({
    'state:device:main-valve': JSON.stringify({
      id: 'main-valve',
      lastSeenAt: now - 300_000,
      lastBatchIsOnline: false,
      offlineAlertActive: true,
      lastOfflineAlertAt: now - 300_000,
    }),
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        {
          message: '⚠️ O device "Main valve" está offline ou indisponível no momento.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
      ],
      integrations: {},
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'main-valve',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'main-valve', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /voltou a ficar online/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 0);
});

test('scheduled check preserves pending device offline notification for a different device', async () => {
  const now = Date.now();
  const state = makeState({
    'state:device:main-valve': JSON.stringify({
      id: 'main-valve',
      lastSeenAt: now - 300_000,
      lastBatchIsOnline: false,
      offlineAlertActive: true,
      lastOfflineAlertAt: now - 300_000,
    }),
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        {
          message: '⚠️ O device "Main valve" está offline ou indisponível no momento.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
        {
          message: '⚠️ O device "Secondary valve" está offline ou indisponível no momento.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
      ],
      integrations: {},
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'main-valve',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'main-valve', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /voltou a ficar online/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 1);
  assert.match(savedGlobalState.pendingNotifications[0].message, /Secondary valve/);
});

test('scheduled check removes only TUYA token failure pending notification on recovery', async () => {
  const now = Date.now();
  const state = makeState({
    condo_automation_state: JSON.stringify({
      devices: {},
      automations: {},
      pendingNotifications: [
        {
          message: '⚠️ Falha ao obter token da Tuya. Verifique credenciais, conectividade ou assinatura da API antes da próxima verificação.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 60_000,
        },
        {
          message: '⚠️ O device "Main valve" está offline ou indisponível no momento.',
          lastAttemptAt: now - 120_000,
          nextAttemptAt: now + 120_000,
        },
      ],
      integrations: {
        tuya: {
          tokenFaultActive: true,
          lastTokenFaultAlertAt: now - 120_000,
        },
      },
    }),
  });
  const runEnv = {
    ...env,
    ...state,
    DRY_RUN: 'false',
    CLIENT_ID: 'test-client-id',
    CLIENT_SECRET: 'test-client-secret',
    TUYA_BASE: 'https://tuya.test',
    TELEGRAM_BOT_TOKEN: 'telegram-token',
    TELEGRAM_CHAT_ID: 'chat-id',
    DEVICE_REGISTRY_JSON: JSON.stringify([
      {
        id: 'main-valve',
        name: 'Main valve',
        type: 'valve',
      },
    ]),
  };
  const sentMessages = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const textUrl = String(url);
    if (textUrl.includes('/v1.0/token')) {
      return new Response(JSON.stringify({
        success: true,
        result: {
          access_token: 'fresh-access-token',
          expire_time: 3600,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v2.0/cloud/thing/batch')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ id: 'main-valve', is_online: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('/v1.0/devices/')) {
      return new Response(JSON.stringify({
        success: true,
        result: [{ code: 'switch_1', value: true }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (textUrl.includes('api.telegram.org')) {
      sentMessages.push(JSON.parse(options.body).text);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unexpected fetch: ${textUrl}`);
  };

  try {
    await handleCheck(runEnv);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /autenticação com a Tuya foi restabelecida/);
  const savedGlobalState = JSON.parse(state.store.get('condo_automation_state'));
  assert.equal(savedGlobalState.pendingNotifications.length, 1);
  assert.match(savedGlobalState.pendingNotifications[0].message, /Main valve/);
});
