import test from 'node:test';
import assert from 'node:assert/strict';

import { isAccessJwtConfigured, verifyAccessJwt, getVerifiedAccessEmail } from '../src/access.js';
import worker from '../src/worker.js';

const TEAM_DOMAIN = 'myteam.cloudflareaccess.com';
const AUD = 'test-aud-tag';

const keyPair = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify']
);

const otherKeyPair = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify']
);

const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
const jwks = { keys: [{ ...publicJwk, kid: 'test-key', use: 'sig', alg: 'RS256' }] };

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function signJwt({ header = {}, payload = {}, privateKey = keyPair.privateKey } = {}) {
  const fullHeader = { alg: 'RS256', kid: 'test-key', ...header };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    aud: [AUD],
    iss: `https://${TEAM_DOMAIN}`,
    exp: now + 300,
    nbf: now - 60,
    email: 'admin@example.test',
    ...payload,
  };

  const data = `${b64url(JSON.stringify(fullHeader))}.${b64url(JSON.stringify(fullPayload))}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(data)
  );

  return `${data}.${Buffer.from(signature).toString('base64url')}`;
}

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

function makeAccessEnv(extra = {}) {
  return {
    CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    CF_ACCESS_AUD: AUD,
    ...makeState(),
    ...extra,
  };
}

async function withJwksFetch(fn, { failJwks = false } = {}) {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async (url) => {
    fetchCount += 1;
    if (String(url).endsWith('/cdn-cgi/access/certs') && !failJwks) {
      return {
        ok: true,
        status: 200,
        json: async () => jwks,
      };
    }
    return {
      ok: false,
      status: 500,
      json: async () => ({}),
    };
  };

  try {
    return await fn(() => fetchCount);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('access JWT mode is disabled unless both env vars are set', () => {
  assert.equal(isAccessJwtConfigured({}), false);
  assert.equal(isAccessJwtConfigured({ CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN }), false);
  assert.equal(isAccessJwtConfigured({ CF_ACCESS_AUD: AUD }), false);
  assert.equal(isAccessJwtConfigured({ CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUD }), true);
});

test('valid Cloudflare Access JWT yields normalized email', async () => {
  await withJwksFetch(async () => {
    const token = await signJwt({ payload: { email: 'Admin@Example.Test' } });
    const email = await verifyAccessJwt(token, makeAccessEnv());
    assert.equal(email, 'admin@example.test');
  });
});

test('expired Access JWT is rejected', async () => {
  await withJwksFetch(async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ payload: { exp: now - 10 } });
    assert.equal(await verifyAccessJwt(token, makeAccessEnv()), null);
  });
});

test('Access JWT with wrong audience is rejected', async () => {
  await withJwksFetch(async () => {
    const token = await signJwt({ payload: { aud: ['other-aud'] } });
    assert.equal(await verifyAccessJwt(token, makeAccessEnv()), null);
  });
});

test('Access JWT with wrong issuer is rejected', async () => {
  await withJwksFetch(async () => {
    const token = await signJwt({ payload: { iss: 'https://attacker.example' } });
    assert.equal(await verifyAccessJwt(token, makeAccessEnv()), null);
  });
});

test('Access JWT signed by an unknown key is rejected', async () => {
  await withJwksFetch(async () => {
    const token = await signJwt({ privateKey: otherKeyPair.privateKey });
    assert.equal(await verifyAccessJwt(token, makeAccessEnv()), null);
  });
});

test('Access JWT with non-RS256 algorithm is rejected', async () => {
  await withJwksFetch(async () => {
    const token = await signJwt({ header: { alg: 'none' } });
    assert.equal(await verifyAccessJwt(token, makeAccessEnv()), null);
  });
});

test('malformed Access JWT returns null without throwing', async () => {
  await withJwksFetch(async () => {
    const env = makeAccessEnv();
    assert.equal(await verifyAccessJwt('not-a-jwt', env), null);
    assert.equal(await verifyAccessJwt('a.b', env), null);
    assert.equal(await verifyAccessJwt('', env), null);
  });
});

test('JWKS is cached in KV after first verification', async () => {
  await withJwksFetch(async (getFetchCount) => {
    const env = makeAccessEnv();
    const token = await signJwt();

    assert.equal(await verifyAccessJwt(token, env), 'admin@example.test');
    assert.equal(getFetchCount(), 1);
    assert.ok(env.store.get('access:jwks'));

    assert.equal(await verifyAccessJwt(token, env), 'admin@example.test');
    assert.equal(getFetchCount(), 1);
  });
});

test('JWKS fetch failure results in rejected JWT, not a crash', async () => {
  await withJwksFetch(async () => {
    const token = await signJwt();
    const request = new Request('https://example.com/api/dashboard-context', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    });
    assert.equal(await getVerifiedAccessEmail(request, makeAccessEnv()), null);
  }, { failJwks: true });
});

test('forged email header is ignored when Access JWT mode is enabled', async () => {
  await withJwksFetch(async () => {
    const env = makeAccessEnv({
      DASHBOARD_ACCESS_TOKEN: 'secret-token',
      DEVICE_REGISTRY_JSON: '[]',
      AUTOMATIONS_JSON: '[]',
      DASHBOARD_USERS_JSON: '[{"email":"admin@example.test","role":"admin"}]',
    });

    const res = await worker.fetch(
      new Request('https://example.com/api/dashboard-context', {
        headers: {
          Authorization: 'Bearer secret-token',
          'Cf-Access-Authenticated-User-Email': 'admin@example.test',
        },
      }),
      env,
      {}
    );

    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.currentUser.role, 'viewer');
    assert.deepEqual(payload.users, []);
  });
});

test('valid Access JWT grants admin role through the worker route', async () => {
  await withJwksFetch(async () => {
    const env = makeAccessEnv({
      DASHBOARD_ACCESS_TOKEN: 'secret-token',
      DEVICE_REGISTRY_JSON: '[]',
      AUTOMATIONS_JSON: '[]',
      DASHBOARD_USERS_JSON: '[{"email":"admin@example.test","role":"admin"}]',
    });

    const token = await signJwt();
    const res = await worker.fetch(
      new Request('https://example.com/api/dashboard-context', {
        headers: {
          Authorization: 'Bearer secret-token',
          'Cf-Access-Jwt-Assertion': token,
        },
      }),
      env,
      {}
    );

    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.currentUser.role, 'admin');
    assert.equal(payload.currentUser.email, 'admin@example.test');
  });
});
