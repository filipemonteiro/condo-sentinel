// filepath: src/notifications.js
/**
 * Envio de notificações (Telegram)
 */

// Limite da API do Telegram para o campo text de sendMessage
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Envia mensagem para o Telegram.
 * Mensagens acima do limite da API são divididas em múltiplos envios,
 * preferindo quebrar no separador de notificações ("\n\n").
 */
export async function sendTelegramMessage(env, message, dryRun = false) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN não configurado.");
  }
  if (!env.TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_CHAT_ID não configurado.");
  }

  const chunks = splitTelegramMessage(message);

  if (dryRun) {
    console.log("DRY_RUN ativo. Mensagem Telegram não enviada.", {
      chatIdConfigured: true,
      messageLength: String(message || "").length,
      chunkCount: chunks.length,
    });
    return;
  }

  for (const chunk of chunks) {
    await sendTelegramChunk(env, chunk);
  }

  console.log("Mensagem enviada ao Telegram com sucesso.", { chunkCount: chunks.length });
}

/**
 * Divide uma mensagem nos limites da API do Telegram.
 * Quebra preferencialmente em "\n\n", depois em "\n", e por fim corte duro.
 */
export function splitTelegramMessage(message, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH) {
  const text = String(message || "");
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n\n", maxLength);
    if (cut <= 0) cut = remaining.lastIndexOf("\n", maxLength);
    if (cut <= 0) cut = maxLength;

    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).replace(/^\n+/, "");
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendTelegramChunk(env, text) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok || data.ok !== true) {
    throw new Error(`Erro ao enviar mensagem no Telegram: ${summarizeTelegramError(data)}`);
  }
}

function summarizeTelegramError(data) {
  if (!data || typeof data !== "object") return "resposta vazia ou inválida";

  return JSON.stringify({
    ok: data.ok === true,
    error_code: data.error_code ?? null,
    description: data.description ?? null,
  });
}
