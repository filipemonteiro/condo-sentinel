// filepath: src/automations.js
/**
 * Lógica de automações
 */

import { toInt } from './utils.js';
import { mergeAutomationStateDefaults } from './state.js';

export { mergeAutomationStateDefaults };

/**
 * Avalia todas as automações habilitadas
 */
export async function evaluateAutomations({ automations, state, now, notifications, context }) {
  for (const rule of automations) {
    if (!rule || rule.enabled === false || !rule.type) {
      continue;
    }

    const ruleKey = getAutomationKey(rule);

    state.automations[ruleKey] = mergeAutomationStateDefaults(
      state.automations[ruleKey]
    );

    const aState = state.automations[ruleKey];

    try {
      switch (rule.type) {
        case "water_reserve_control":
          evaluateWaterReserveControl(rule, aState, context, now, notifications);
          break;
        default:
          console.warn(`Tipo de automação não suportado ainda: ${rule.type}`);
      }
    } catch (err) {
      console.error(`Erro avaliando automação ${rule.id || "(sem id)"}`, err);
    }
  }
}

/**
 * Avalia automação de controle de reserva d'água
 */
export function evaluateWaterReserveControl(rule, aState, context, now, notifications) {
  const sourceRoles = Array.isArray(rule.sourceRoles) ? rule.sourceRoles : [];
  const valveRole = rule.targetValveRole;
  const openForMinutes = toInt(rule?.action?.openForMinutes, 15);
  const allBelowPercent = toInt(rule?.trigger?.allBelowPercent, 20);
  const minConsecutiveChecks = toInt(rule?.trigger?.minConsecutiveChecks, 3);
  const cooldownMinutes = toInt(rule?.notify?.cooldownMinutes, 120);
  const cooldownMs = cooldownMinutes * 60 * 1000;

  if (sourceRoles.length === 0 || !valveRole) {
    return;
  }

  const readings = [];
  for (const role of sourceRoles) {
    const r = context.readingsByRole[role];
    if (!r || r.type !== "water_level_sensor" || r.valid !== true || !Number.isFinite(r.percent)) {
      return;
    }
    readings.push({ role, reading: r });
  }

  const allBelow = readings.every(item => item.reading.percent <= allBelowPercent);

  if (allBelow) {
    aState.triggerCount = (aState.triggerCount || 0) + 1;
  } else {
    aState.triggerCount = 0;
    aState.plannedActionAlertActive = false;
    return;
  }

  const shouldAnnounce =
    !aState.plannedActionAlertActive &&
    aState.triggerCount >= minConsecutiveChecks &&
    now - (aState.lastPlannedActionAlertAt || 0) > cooldownMs;

  if (!shouldAnnounce) {
    return;
  }

  const levels = readings
    .map(item => `${item.role}: ${item.reading.percent}%`)
    .join(", ");

  notifications.push(
    `🤖 Automação prevista: no cenário atual (${levels}), a automação "${rule.name || rule.id || "sem nome"}" irá abrir em breve a válvula "${valveRole}" por ${openForMinutes} minuto(s) para apoiar o abastecimento. Nesta versão, a ação ainda não será executada automaticamente; apenas sinalizada.`
  );

  aState.plannedActionAlertActive = true;
  aState.lastPlannedActionAlertAt = now;
}

/**
 * Gera chave única para automação
 */
export function getAutomationKey(rule) {
  if (rule.id) return rule.id;

  const type = rule.type || "unknown";
  const targetValveRole = rule.targetValveRole || "no_target";
  const sourceRoles = Array.isArray(rule.sourceRoles) ? rule.sourceRoles.join("_") : "no_sources";

  return `${type}__${targetValveRole}__${sourceRoles}`;
}
