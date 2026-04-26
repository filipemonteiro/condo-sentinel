import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getInvalidWaterLevelReadingReason,
  isAlarmLikeValue,
  parseJsonEnv,
  sanitizeBatchInfo,
  statusArrayToMap,
  toBool,
  toInt,
  toNumber,
} from '../src/utils.js';

test('parses primitive configuration helpers', () => {
  assert.equal(toInt('15', 60), 15);
  assert.equal(toInt('not-a-number', 60), 60);
  assert.equal(toNumber('42.5'), 42.5);
  assert.equal(toNumber(''), 0);
  assert.equal(toNumber('NaN'), null);
  assert.equal(toBool('true'), true);
  assert.equal(toBool('false'), false);
  assert.equal(toBool('', true), true);
});

test('parses JSON env values with fallback', () => {
  assert.deepEqual(parseJsonEnv('[{"id":"device_1"}]', []), [{ id: 'device_1' }]);
  assert.deepEqual(parseJsonEnv('', [{ fallback: true }]), [{ fallback: true }]);

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(parseJsonEnv('invalid json', []), []);
  } finally {
    console.error = originalConsoleError;
  }
});

test('maps status arrays and detects alarm-like values', () => {
  assert.deepEqual(
    statusArrayToMap([
      { code: 'alarm', value: 'gas_alarm' },
      { code: 'battery', value: 95 },
    ]),
    { alarm: 'gas_alarm', battery: 95 }
  );

  assert.equal(isAlarmLikeValue(true), true);
  assert.equal(isAlarmLikeValue('triggered'), true);
  assert.equal(isAlarmLikeValue('normal'), false);
});

test('validates water level readings', () => {
  assert.equal(getInvalidWaterLevelReadingReason({ percent: 55, state: 'normal' }), null);
  assert.equal(getInvalidWaterLevelReadingReason({ percent: null }), 'percentual ausente ou não numérico');
  assert.equal(getInvalidWaterLevelReadingReason({ percent: 125 }), 'percentual fora da faixa (125%)');
  assert.equal(getInvalidWaterLevelReadingReason({ percent: 50, state: 'err_sensor' }), 'err_sensor');
});

test('sanitizes Tuya batch info without leaking noisy fields', () => {
  assert.deepEqual(
    sanitizeBatchInfo({
      id: 'device_1',
      name: 'Pump Room',
      ip: '192.0.2.10',
      secret_field: 'do-not-include',
    }),
    {
      id: 'device_1',
      name: 'Pump Room',
      custom_name: null,
      product_name: null,
      category: null,
      is_online: null,
      update_time: null,
      active_time: null,
      time_zone: null,
      ip: '192.0.2.10',
    }
  );
});
