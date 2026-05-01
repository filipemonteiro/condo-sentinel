import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateAutomations,
  evaluateWaterReserveControl,
  getAutomationKey,
  mergeAutomationStateDefaults,
} from '../src/automations.js';

test('generates stable automation keys', () => {
  assert.equal(getAutomationKey({ id: 'auto_1' }), 'auto_1');
  assert.equal(
    getAutomationKey({
      type: 'water_reserve_control',
      targetValveRole: 'valve_main',
      sourceRoles: ['tank_a', 'tank_b'],
    }),
    'water_reserve_control__valve_main__tank_a_tank_b'
  );
});

test('merges automation state defaults', () => {
  assert.deepEqual(
    mergeAutomationStateDefaults({ triggerCount: 2 }),
    {
      triggerCount: 2,
      plannedActionAlertActive: false,
      lastPlannedActionAlertAt: 0,
    }
  );
});

test('announces water reserve control after consecutive low readings', () => {
  const rule = {
    id: 'reserve',
    name: 'Reserve control',
    sourceRoles: ['tank_a', 'tank_b'],
    targetValveRole: 'valve_main',
    trigger: {
      allBelowPercent: 20,
      minConsecutiveChecks: 2,
    },
    action: {
      openForMinutes: 15,
    },
    notify: {
      cooldownMinutes: 120,
    },
  };

  const aState = mergeAutomationStateDefaults();
  const notifications = [];
  const context = {
    readingsByRole: {
      tank_a: { type: 'water_level_sensor', valid: true, percent: 15 },
      tank_b: { type: 'water_level_sensor', valid: true, percent: 18 },
    },
  };

  evaluateWaterReserveControl(rule, aState, context, 10_000_000, notifications);
  assert.equal(notifications.length, 0);
  assert.equal(aState.triggerCount, 1);

  evaluateWaterReserveControl(rule, aState, context, 10_060_000, notifications);
  assert.equal(notifications.length, 1);
  assert.equal(aState.plannedActionAlertActive, true);
});

test('evaluates water reserve automation as dry-run notification only', async () => {
  const rule = {
    id: 'reserve',
    type: 'water_reserve_control',
    name: 'Reserve control',
    sourceRoles: ['tank_a', 'tank_b'],
    targetValveRole: 'valve_main',
    trigger: {
      allBelowPercent: 20,
      minConsecutiveChecks: 1,
    },
    action: {
      openForMinutes: 15,
    },
  };
  const state = {
    automations: {},
  };
  const notifications = [];
  const valve = { id: 'valve-test', type: 'valve', currentValue: false };
  const context = {
    devicesByRole: {
      valve_main: valve,
    },
    readingsByRole: {
      tank_a: { type: 'water_level_sensor', valid: true, percent: 15 },
      tank_b: { type: 'water_level_sensor', valid: true, percent: 18 },
    },
  };

  await evaluateAutomations({
    automations: [rule],
    state,
    now: 10_000_000,
    notifications,
    context,
  });

  assert.equal(notifications.length, 1);
  assert.match(notifications[0], /Automação prevista/);
  assert.match(notifications[0], /a ação ainda não será executada automaticamente/);
  assert.deepEqual(valve, { id: 'valve-test', type: 'valve', currentValue: false });
  assert.equal(state.automations.reserve.plannedActionAlertActive, true);
});
