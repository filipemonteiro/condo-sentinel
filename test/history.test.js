import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHistoryPoint, shouldAppendHistoryPoint } from '../src/history.js';

test('builds water level history points', () => {
  assert.deepEqual(
    buildHistoryPoint(
      { type: 'water_level_sensor' },
      { percent: 42, state: 'normal', battery: 91, valid: true },
      true,
      1000
    ),
    {
      ts: 1000,
      type: 'water_level_sensor',
      online: true,
      percent: 42,
      state: 'normal',
      battery: 91,
      valid: true,
    }
  );
});

test('appends history when water level changes enough', () => {
  const device = { type: 'water_level_sensor' };
  const last = { ts: 0, online: true, percent: 50, state: 'normal', valid: true };
  const next = { ts: 60_000, online: true, percent: 53, state: 'normal', valid: true };

  assert.equal(
    shouldAppendHistoryPoint({
      device,
      last,
      next,
      minIntervalMs: 15 * 60_000,
      minDeltaPercent: 2,
    }),
    true
  );
});

test('skips history when nothing meaningful changed before interval', () => {
  const device = { type: 'water_level_sensor' };
  const last = { ts: 0, online: true, percent: 50, state: 'normal', valid: true };
  const next = { ts: 60_000, online: true, percent: 51, state: 'normal', valid: true };

  assert.equal(
    shouldAppendHistoryPoint({
      device,
      last,
      next,
      minIntervalMs: 15 * 60_000,
      minDeltaPercent: 2,
    }),
    false
  );
});

test('appends history when minimum interval is reached without relevant delta', () => {
  const device = { type: 'water_level_sensor' };
  const last = { ts: 0, online: true, percent: 50, state: 'normal', valid: true };
  const next = { ts: 15 * 60_000, online: true, percent: 51, state: 'normal', valid: true };

  assert.equal(
    shouldAppendHistoryPoint({
      device,
      last,
      next,
      minIntervalMs: 15 * 60_000,
      minDeltaPercent: 2,
    }),
    true
  );
});

test('appends history when availability changes', () => {
  assert.equal(
    shouldAppendHistoryPoint({
      device: { type: 'gas_sensor' },
      last: { ts: 0, online: true, alarm: false },
      next: { ts: 1000, online: false, alarm: false },
      minIntervalMs: 15 * 60_000,
      minDeltaPercent: 2,
    }),
    true
  );
});
