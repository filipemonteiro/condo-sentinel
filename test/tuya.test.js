import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTuyaToken,
  buildTuyaSignedRequest,
  getTuyaDeviceStatus,
  getTuyaDevicesBatchInfo,
  buildBatchDeviceMap,
} from '../src/tuya.js';
import { sha256Hex, hmacSha256Upper } from '../src/utils.js';

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

function makeEnv(extra = {}) {
  return {
    CLIENT_ID: 'client-id',
    CLIENT_SECRET: 'client-secret',
    TUYA_BASE: 'https://tuya.test',
    ...makeState(),
    ...extra,
  };
}

async function withTuyaFetch(fn, responses) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const response = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (response.networkError) {
      throw new Error('network failure');
    }
    return {
      ok: response.status < 400,
      status: response.status ?? 200,
      json: async () => response.data,
    };
  };

  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('reuses cached Tuya token while still valid', async () => {
  const env = makeEnv();
  env.store.set(
    'tuya:access_token',
    JSON.stringify({ token: 'cached-token', expiresAt: Date.now() + 10 * 60 * 1000 })
  );

  await withTuyaFetch(async (calls) => {
    const token = await getTuyaToken(env);
    assert.equal(token, 'cached-token');
    assert.equal(calls.length, 0);
  }, []);
});

test('fetches and caches a new token when the cached one is near expiry', async () => {
  const env = makeEnv();
  env.store.set(
    'tuya:access_token',
    JSON.stringify({ token: 'stale-token', expiresAt: Date.now() + 30 * 1000 })
  );

  await withTuyaFetch(async (calls) => {
    const token = await getTuyaToken(env);

    assert.equal(token, 'fresh-token');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\.0\/token\?grant_type=1$/);

    const cached = JSON.parse(env.store.get('tuya:access_token'));
    assert.equal(cached.token, 'fresh-token');
    assert.ok(cached.expiresAt > Date.now());
  }, [
    { status: 200, data: { success: true, result: { access_token: 'fresh-token', expire_time: 7200 } } },
  ]);
});

test('throws a summarized error when token acquisition fails', async () => {
  const env = makeEnv();

  await withTuyaFetch(async () => {
    await assert.rejects(
      () => getTuyaToken(env),
      (err) => {
        assert.match(err.message, /Falha ao obter token da Tuya/);
        assert.match(err.message, /"code":1004/);
        return true;
      }
    );
  }, [
    { status: 200, data: { success: false, code: 1004, msg: 'sign invalid' } },
  ]);
});

test('signed request carries the documented Tuya HMAC signature', async () => {
  const env = makeEnv();
  const path = '/v1.0/devices/device-1/status';

  const { headers } = await buildTuyaSignedRequest(env, {
    method: 'GET',
    path,
    body: '',
    accessToken: 'access-token',
  });

  assert.equal(headers.client_id, 'client-id');
  assert.equal(headers.sign_method, 'HMAC-SHA256');
  assert.equal(headers.access_token, 'access-token');
  assert.ok(headers.t);
  assert.ok(headers.nonce);

  // Recalcula a assinatura com os mesmos t/nonce e compara
  const bodyHash = await sha256Hex('');
  const stringToSign = ['GET', bodyHash, '', path].join('\n');
  const expected = await hmacSha256Upper(
    'client-secret',
    `client-idaccess-token${headers.t}${headers.nonce}${stringToSign}`
  );
  assert.equal(headers.sign, expected);
});

test('signed request without access token omits the access_token header', async () => {
  const env = makeEnv();

  const { headers } = await buildTuyaSignedRequest(env, {
    method: 'GET',
    path: '/v1.0/token?grant_type=1',
    body: '',
    accessToken: null,
  });

  assert.equal(headers.access_token, undefined);
  assert.ok(headers.sign);
});

test('throws when Tuya credentials are missing', async () => {
  await assert.rejects(
    () => buildTuyaSignedRequest({ CLIENT_ID: 'only-id' }, { method: 'GET', path: '/x' }),
    /CLIENT_ID ou CLIENT_SECRET/
  );
});

test('device status retries on 5xx and succeeds', async () => {
  const env = makeEnv();

  await withTuyaFetch(async (calls) => {
    const data = await getTuyaDeviceStatus(env, 'token', 'device-1');

    assert.equal(calls.length, 2);
    assert.deepEqual(data.result, [{ code: 'battery_percentage', value: 88 }]);
  }, [
    { status: 502, data: {} },
    { status: 200, data: { success: true, result: [{ code: 'battery_percentage', value: 88 }] } },
  ]);
});

test('device status does not retry on 4xx responses', async () => {
  const env = makeEnv();

  await withTuyaFetch(async (calls) => {
    await assert.rejects(
      () => getTuyaDeviceStatus(env, 'token', 'device-1'),
      /Resposta inválida de status da Tuya/
    );
    assert.equal(calls.length, 1);
  }, [
    { status: 400, data: { success: false, code: 1010, msg: 'token invalid' } },
  ]);
});

test('device status error redacts the device id', async () => {
  const env = makeEnv();

  await withTuyaFetch(async () => {
    await assert.rejects(
      () => getTuyaDeviceStatus(env, 'token', 'device-super-secret-id'),
      (err) => {
        assert.doesNotMatch(err.message, /device-super-secret-id/);
        assert.match(err.message, /dev\.\.\.-id/);
        return true;
      }
    );
  }, [
    { status: 200, data: { success: false, code: 1010, msg: 'token invalid' } },
  ]);
});

test('batch info returns empty list without calling the API for no ids', async () => {
  const env = makeEnv();

  await withTuyaFetch(async (calls) => {
    assert.deepEqual(await getTuyaDevicesBatchInfo(env, 'token', []), []);
    assert.equal(calls.length, 0);
  }, []);
});

test('batch info caps each request at 20 device ids', async () => {
  const env = makeEnv();
  const ids = Array.from({ length: 25 }, (_, i) => `device-${i}`);

  await withTuyaFetch(async (calls) => {
    await getTuyaDevicesBatchInfo(env, 'token', ids);

    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    const sent = decodeURIComponent(url.searchParams.get('device_ids')).split(',');
    assert.equal(sent.length, 20);
  }, [
    { status: 200, data: { success: true, result: [] } },
  ]);
});

test('builds batch device map keyed by id', () => {
  const map = buildBatchDeviceMap([
    { id: 'a', is_online: true },
    { id: 'b', is_online: false },
    null,
    { no_id: true },
  ]);

  assert.deepEqual(Object.keys(map), ['a', 'b']);
  assert.equal(map.a.is_online, true);
});
