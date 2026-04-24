// filepath: src/tuya.js
/**
 * Integração com API da Tuya
 */

import { sha256Hex, hmacSha256Upper, statusArrayToMap, sanitizeBatchInfo } from './utils.js';

/**
 * Obtém token de acesso da Tuya
 */
export async function getTuyaToken(env) {
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

  return data.result.access_token;
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

  const res = await fetch(`${env.TUYA_BASE}${path}`, {
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

  const res = await fetch(`${env.TUYA_BASE}${path}`, {
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