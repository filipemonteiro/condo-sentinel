import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('wrangler example does not ship runtime secrets or token placeholders', async () => {
  const content = await readFile(new URL('../wrangler.example.toml', import.meta.url), 'utf8');

  assert.doesNotMatch(content, /^\[vars\]/m);
  assert.doesNotMatch(content, /DASHBOARD_ACCESS_TOKEN/);
  assert.doesNotMatch(content, /TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(content, /CLIENT_SECRET|TUYA_CLIENT_SECRET/);
  assert.match(content, /keep_vars = true/);
});

test('deploy workflow blocks runtime vars from generated wrangler config', async () => {
  const content = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

  assert.match(content, /Guard runtime secrets/);
  assert.match(content, /DASHBOARD_ACCESS_TOKEN/);
  assert.match(content, /TELEGRAM_BOT_TOKEN/);
  assert.match(content, /CLIENT_SECRET/);
});
