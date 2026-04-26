import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';
import { renderDashboardHtml } from '../src/dashboard.js';

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

  const payload = await res.json();
  assert.equal(payload.summary.totalDevices, 0);
});

test('dashboard includes session timeout and token form shell', () => {
  const html = renderDashboardHtml({ sessionTimeoutMinutes: 45 });

  assert.match(html, /const SESSION_TIMEOUT_MS = 45 \* 60 \* 1000;/);
  assert.match(html, /id="auth-form"/);
  assert.match(html, /sessionStorage/);
  assert.match(html, /Authorization: 'Bearer '/);
});
