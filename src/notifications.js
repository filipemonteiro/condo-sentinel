// filepath: src/notifications.js
/**
 * Envio de notificações (Telegram)
 */

/**
 * Envia mensagem para o Telegram
 */
export async function sendTelegramMessage(env, message, dryRun = false) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN não configurado.");
  }
  if (!env.TELEGRAM_CHAT_ID) {
    throw new Error("TELEGRAM_CHAT_ID não configurado.");
  }

  if (dryRun) {
    console.log("DRY_RUN ativo. Mensagem Telegram não enviada.", {
      chatId: env.TELEGRAM_CHAT_ID,
      message,
    });
    return;
  }

  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  const payload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message,
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
    throw new Error(`Erro ao enviar mensagem no Telegram: ${JSON.stringify(data)}`);
  }

  console.log("Mensagem enviada ao Telegram com sucesso.");
}