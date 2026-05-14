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
