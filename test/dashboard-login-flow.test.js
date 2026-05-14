import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { renderDashboardHtml } from '../src/dashboard.js';

function createElement(id) {
  const classes = new Set(id === 'app-shell' ? ['locked'] : []);
  let listener = null;

  return {
    id,
    innerHTML: '',
    textContent: '',
    style: {},
    value: '',
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(_event, handler) {
      listener = handler;
    },
    focus() {},
    get listener() {
      return listener;
    },
  };
}

test('dashboard token submit sends bearer auth and unlocks app shell', async () => {
  const html = renderDashboardHtml({ sessionTimeoutMinutes: 30 });
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/);
  assert.ok(scriptMatch, 'dashboard inline script should be present');

  const elements = {
    'auth-form': createElement('auth-form'),
    'dashboard-token': createElement('dashboard-token'),
    'auth-error': createElement('auth-error'),
    'auth-screen': createElement('auth-screen'),
    'app-shell': createElement('app-shell'),
    summary: createElement('summary'),
    devices: createElement('devices'),
    dashboard: createElement('dashboard'),
  };

  const storage = new Map();
  const requests = [];
  const document = {
    getElementById(id) {
      return elements[id] || createElement(id);
    },
    querySelectorAll(selector) {
      if (selector === '.section') return [elements.dashboard];
      if (selector === '.menu button') {
        return [
          {
            classList: { add() {}, remove() {} },
            addEventListener() {},
            getAttribute() {
              return 'dashboard';
            },
          },
        ];
      }
      return [];
    },
    querySelector() {
      return {
        classList: { add() {}, remove() {} },
      };
    },
  };

  const context = {
    document,
    sessionStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    Date,
    Chart: class {},
    console: {
      error() {},
      log() {},
      warn() {},
    },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({
        summary: {
          totalDevices: 0,
          onlineDevices: 0,
          offlineDevices: 0,
          staleDevices: 0,
          devicesInAlarm: 0,
          devicesWithFault: 0,
          devicesLowLevel: 0,
        },
        devices: [],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };

  vm.runInNewContext(scriptMatch[1], context);

  elements['dashboard-token'].value = 'test-dashboard-token';
  await elements['auth-form'].listener({
    preventDefault() {},
  });

  assert.equal(requests[0].url, '/api/status');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-dashboard-token');
  assert.equal(elements['app-shell'].classList.contains('locked'), false);
  assert.equal(elements['auth-screen'].classList.contains('active'), false);
});
