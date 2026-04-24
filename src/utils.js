// filepath: src/utils.js
/**
 * Funções utilitárias do worker
 */

/**
 * Converte valor para inteiro
 */
export function toInt(value, fallback) {
  const n = parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Converte valor para número
 */
export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converte valor para booleano
 */
export function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

/**
 * Faz parse de JSON de variável de ambiente
 */
export function parseJsonEnv(value, fallback) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  if (!String(value).trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error("Erro ao fazer parse do JSON de env:", value);
    console.error("Detalhe:", stringifyError(err));
    return fallback;
  }
}

/**
 * Converte array de status para map
 */
export function statusArrayToMap(resultArray) {
  return Object.fromEntries((resultArray || []).map(item => [item.code, item.value]));
}

/**
 * Stringifica erro para logging
 */
export function stringifyError(err) {
  if (!err) return "erro desconhecido";
  if (err.stack) return err.stack;
  if (err.message) return err.message;
  return String(err);
}

/**
 * Calcula hash SHA-256 em hex
 */
export async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Calcula HMAC-SHA256 em hex uppercase
 */
export async function hmacSha256Upper(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Verifica se valor indica alarme
 */
export function isAlarmLikeValue(value) {
  if (value === true) return true;
  if (value === 1) return true;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return [
      "alarm",
      "warn",
      "warning",
      "on",
      "true",
      "detected",
      "gas_alarm",
      "leak",
      "leak_alarm",
      "presence",
      "triggered",
    ].includes(normalized);
  }

  return false;
}

/**
 * Retorna razão de leitura inválida de sensor de nível
 */
export function getInvalidWaterLevelReadingReason(reading) {
  if (!Number.isFinite(reading.percent)) {
    return "percentual ausente ou não numérico";
  }

  if (reading.percent < 0 || reading.percent > 100) {
    return `percentual fora da faixa (${reading.percent}%)`;
  }

  if (typeof reading.state === "string" && reading.state.startsWith("err_")) {
    return reading.state;
  }

  return null;
}

/**
 * Sanitiza info do batch
 */
export function sanitizeBatchInfo(info) {
  if (!info || typeof info !== "object") return null;

  return {
    id: info.id ?? null,
    name: info.name ?? null,
    custom_name: info.custom_name ?? null,
    product_name: info.product_name ?? null,
    category: info.category ?? null,
    is_online: info.is_online ?? null,
    update_time: info.update_time ?? null,
    active_time: info.active_time ?? null,
    time_zone: info.time_zone ?? null,
    ip: info.ip ?? null,
  };
}

/**
 * Cria resposta JSON
 */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Cria resposta HTML
 */
export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}