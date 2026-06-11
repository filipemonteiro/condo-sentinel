import test from 'node:test';
import assert from 'node:assert/strict';

import { sendTelegramMessage, splitTelegramMessage } from '../src/notifications.js';

const baseEnv = {
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_CHAT_ID: 'chat-id',
};

async function withTelegramFetch(fn, { responses = null } = {}) {
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    const response = responses
      ? responses[Math.min(calls.length - 1, responses.length - 1)]
      : { ok: true, status: 200, data: { ok: true } };

    return {
      ok: response.ok,
      status: response.status,
      json: async () => response.data,
    };
  };

  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('throws when Telegram credentials are missing', async () => {
  await assert.rejects(
    () => sendTelegramMessage({ TELEGRAM_CHAT_ID: 'chat-id' }, 'msg'),
    /TELEGRAM_BOT_TOKEN/
  );
  await assert.rejects(
    () => sendTelegramMessage({ TELEGRAM_BOT_TOKEN: 'bot-token' }, 'msg'),
    /TELEGRAM_CHAT_ID/
  );
});

test('dry run does not call the Telegram API', async () => {
  await withTelegramFetch(async (calls) => {
    await sendTelegramMessage(baseEnv, 'mensagem de teste', true);
    assert.equal(calls.length, 0);
  });
});

test('sends a single message under the API limit', async () => {
  await withTelegramFetch(async (calls) => {
    await sendTelegramMessage(baseEnv, 'alerta curto', false);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.chat_id, 'chat-id');
    assert.equal(calls[0].body.text, 'alerta curto');
  });
});

test('splits oversized batches preferring the notification separator', () => {
  const alert = 'A'.repeat(1500);
  const message = [alert, alert, alert, alert].join('\n\n');

  const chunks = splitTelegramMessage(message);

  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 4096, `chunk com ${chunk.length} chars excede o limite`);
  }
  // Nenhum alerta individual é cortado no meio
  assert.deepEqual(chunks.join('\n\n').split('\n\n'), [alert, alert, alert, alert]);
});

test('hard-cuts a single oversized line without newlines', () => {
  const message = 'B'.repeat(9000);

  const chunks = splitTelegramMessage(message);

  assert.equal(chunks.length, 3);
  assert.ok(chunks.every(chunk => chunk.length <= 4096));
  assert.equal(chunks.join(''), message);
});

test('sends every chunk of an oversized batch', async () => {
  const alert = 'C'.repeat(3000);
  const message = [alert, alert, alert].join('\n\n');

  await withTelegramFetch(async (calls) => {
    await sendTelegramMessage(baseEnv, message, false);

    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(call => call.body.text), [alert, alert, alert]);
  });
});

test('throws a summarized error when Telegram rejects the message', async () => {
  await withTelegramFetch(
    async () => {
      await assert.rejects(
        () => sendTelegramMessage(baseEnv, 'alerta', false),
        (err) => {
          assert.match(err.message, /Erro ao enviar mensagem no Telegram/);
          assert.match(err.message, /"error_code":429/);
          assert.doesNotMatch(err.message, /raw-internal-detail/);
          return true;
        }
      );
    },
    {
      responses: [
        {
          ok: false,
          status: 429,
          data: { ok: false, error_code: 429, description: 'Too Many Requests', raw: 'raw-internal-detail' },
        },
      ],
    }
  );
});
