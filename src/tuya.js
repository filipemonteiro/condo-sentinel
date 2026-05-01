// filepath: src/tuya.js
/**
 * Integração com API da Tuya
 */

import { sha256Hex, hmacSha256Upper } from './utils.js';

/**
 * Executa fetch com retry simples para falhas temporárias.
 */
async function fetchWithRetry(url, options, maxAttempts = 3, baseDelayMs = 500) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      // Só retenta em erros de servidor (5xx) ou timeout de rede
      if (res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Obtém token de acesso da Tuya
 */
export async function getTuyaToken(env) {
  try {
    const cachedRaw = await env.STATE.get("tuya:access_token");
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw);
      if (cached?.token && cached.expiresAt - Date.now() > 60_000) {
        return cached.token;
      }
    }
  } catch (err) {
    console.warn("Falha ao ler token Tuya do KV, seguindo com nova autenticação.", err);
  }

  const path = `/v1.0/token?grant_type=1`;
  const method = "GET";
  const body = "";

  const signed = await buildTuyaSignedRequest(env, {
    method,
    path,
    body,
    accessToken: null,
  });

  const res = await fetch(`${env.TUYA_BASE}${path}`, {
    method,
    headers: signed.headers,
  });

  const data = await res.json();

  if (!data.success || !data.result?.access_token) {
    throw new Error(`Falha ao obter token da Tuya: ${JSON.stringify(data)}`);
  }

  const token = data.result.access_token;
  const expireTime = Number(data.result.expire_time || 0);
  const expiresAt = Date.now() + (expireTime * 1000);
  await env.STATE.put("tuya:access_token", JSON.stringify({ token, expiresAt }));

  return token;
}

/**
 * Constrói requisição assinada para API Tuya
 */
export async function buildTuyaSignedRequest(env, { method, path, body = "", accessToken = null }) {
  const clientId = env.CLIENT_ID;
  const clientSecret = env.CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("CLIENT_ID ou CLIENT_SECRET não configurados.");
  }

  const t = String(Date.now());
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const bodyHash = await sha256Hex(body || "");
  const stringToSign = [method.toUpperCase(), bodyHash, "", path].join("\n");

  const signStr = accessToken
    ? `${clientId}${accessToken}${t}${nonce}${stringToSign}`
    : `${clientId}${t}${nonce}${stringToSign}`;

  const sign = await hmacSha256Upper(clientSecret, signStr);

  const headers = {
    client_id: clientId,
    t,
    nonce,
    sign_method: "HMAC-SHA256",
    sign,
    mode: "cors",
    "Content-Type": "application/json",
  };

  if (accessToken) {
    headers.access_token = accessToken;
  }

  return { headers };
}

/**
 * Obtém status de um device específico
 */
export async function getTuyaDeviceStatus(env, accessToken, deviceId, logFullPayload = false) {
  const path = `/v1.0/devices/${deviceId}/status`;
  const method = "GET";
  const body = "";

  const signed = await buildTuyaSignedRequest(env, {
    method,
    path,
    body,
    accessToken,
  });

  const res = await fetchWithRetry(`${env.TUYA_BASE}${path}`, {
    method,
    headers: signed.headers,
  });

  const data = await res.json();

  if (logFullPayload) {
    console.log(`Tuya status payload [${deviceId}]:`, JSON.stringify(data));
  }

  if (!data.success || !Array.isArray(data.result)) {
    throw new Error(`Resposta inválida de status da Tuya para ${deviceId}: ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Obtém informações em batch de múltiplos devices
 */
export async function getTuyaDevicesBatchInfo(env, accessToken, deviceIds, logFullPayload = false) {
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    return [];
  }

  const ids = deviceIds.slice(0, 20).join(",");
  const path = `/v2.0/cloud/thing/batch?device_ids=${encodeURIComponent(ids)}`;
  const method = "GET";
  const body = "";

  const signed = await buildTuyaSignedRequest(env, {
    method,
    path,
    body,
    accessToken,
  });

  const res = await fetchWithRetry(`${env.TUYA_BASE}${path}`, {
    method,
    headers: signed.headers,
  });

  const data = await res.json();

  if (logFullPayload) {
    console.log("Tuya batch payload:", JSON.stringify(data));
  }

  if (!data.success || !Array.isArray(data.result)) {
    throw new Error(`Resposta inválida do batch da Tuya: ${JSON.stringify(data)}`);
  }

  return data.result;
}

/**
 * Obtém batch info de todos os devices (com paginação)
 */
export async function getAllDevicesBatchInfo(env, accessToken, deviceIds, logFullPayload = false) {
  const results = [];

  for (let i = 0; i < deviceIds.length; i += 20) {
    const chunk = deviceIds.slice(i, i + 20);
    const batch = await getTuyaDevicesBatchInfo(env, accessToken, chunk, logFullPayload);
    results.push(...batch);
  }

  return results;
}

/**
 * Constrói map de devices por ID
 */
export function buildBatchDeviceMap(batchResult) {
  const map = {};
  for (const item of batchResult || []) {
    if (item && item.id) {
      map[item.id] = item;
    }
  }
  return map;
}
