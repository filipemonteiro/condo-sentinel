// filepath: src/access.js
/**
 * Validação de identidade via Cloudflare Access (JWT)
 *
 * Quando CF_ACCESS_TEAM_DOMAIN e CF_ACCESS_AUD estão configurados, o e-mail
 * do usuário só é aceito a partir do JWT assinado pelo Cloudflare Access
 * (header Cf-Access-Jwt-Assertion), validado contra o JWKS do team.
 * Headers simples como Cf-Access-Authenticated-User-Email passam a ser
 * ignorados, pois podem ser forjados pelo cliente.
 */

const JWKS_CACHE_KEY = "access:jwks";
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Indica se a validação por JWT está habilitada no ambiente
 */
export function isAccessJwtConfigured(env) {
  return Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD);
}

/**
 * Extrai e valida o e-mail do JWT do Cloudflare Access.
 * Retorna o e-mail normalizado (lowercase) ou null se ausente/inválido.
 */
export async function getVerifiedAccessEmail(request, env) {
  try {
    const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!assertion) return null;
    return await verifyAccessJwt(assertion, env);
  } catch (err) {
    console.warn("Falha ao validar JWT do Cloudflare Access.", err);
    return null;
  }
}

/**
 * Valida um JWT RS256 do Cloudflare Access (assinatura, iss, aud, exp, nbf).
 * Retorna o e-mail do payload validado ou null.
 */
export async function verifyAccessJwt(token, env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;

  const header = decodeJwtJson(parts[0]);
  const payload = decodeJwtJson(parts[1]);
  if (!header || !payload) return null;
  if (header.alg !== "RS256" || !header.kid) return null;

  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  if (!teamDomain) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(env.CF_ACCESS_AUD)) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) return null;
  if (Number.isFinite(payload.nbf) && payload.nbf > nowSeconds) return null;

  const key = await getSigningKey(env, teamDomain, header.kid);
  if (!key) return null;

  const signature = base64UrlToBytes(parts[2]);
  if (!signature) return null;

  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!valid) return null;

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  return email || null;
}

function normalizeTeamDomain(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function decodeJwtJson(part) {
  const bytes = base64UrlToBytes(part);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function base64UrlToBytes(value) {
  try {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function getSigningKey(env, teamDomain, kid) {
  let jwks = await loadCachedJwks(env);
  let jwk = findJwk(jwks, kid);

  // kid ausente no cache pode indicar rotação de chaves — busca JWKS fresco
  if (!jwk) {
    jwks = await fetchAndCacheJwks(env, teamDomain);
    jwk = findJwk(jwks, kid);
  }

  if (!jwk) return null;

  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function findJwk(jwks, kid) {
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  return keys.find(key => key && key.kid === kid && key.kty === "RSA") || null;
}

async function loadCachedJwks(env) {
  try {
    const raw = await env.STATE.get(JWKS_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.jwks) return null;
    if (Date.now() - (cached.fetchedAt || 0) > JWKS_CACHE_TTL_MS) return null;
    return cached.jwks;
  } catch {
    return null;
  }
}

async function fetchAndCacheJwks(env, teamDomain) {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) {
    throw new Error(`Falha ao obter JWKS do Cloudflare Access: HTTP ${res.status}`);
  }
  const jwks = await res.json();

  try {
    await env.STATE.put(JWKS_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), jwks }));
  } catch {
    // Cache é otimização; falha de escrita não impede a validação
  }

  return jwks;
}
