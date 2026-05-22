'use strict';

/**
 * POLICY — riskGates.policy.js
 *
 * Puertas de riesgo operativo: health score, warm-up, pauses, circuit breakers.
 * Si alguna de estas condiciones falla, el envio se bloquea o se requiere aprobacion.
 *
 * Scope: router_ai.routing
 */

const HEALTH_SCORE_BLOCK_THRESHOLD    = 30;
const HEALTH_SCORE_APPROVAL_THRESHOLD = 60;

module.exports = function buildRiskGatesPolicy() {
  return {
    name: 'router_ai.risk_gates',
    description: 'Bloquea o escala si el health score, warm-up, pauses o circuit breakers lo requieren.',
    async evaluate(ctx) {
      const risk = ctx.risk || {};
      const opState = ctx.operationalState || {};

      // Tenant/campana/numero pausado
      if (opState.companyPaused) {
        return {
          allowed: false,
          code: 'TENANT_PAUSED',
          reason: 'El tenant esta pausado. No se pueden enviar campanas.',
          metadata: {},
        };
      }

      if (Array.isArray(opState.providerPauses) && opState.providerPauses.length > 0) {
        return {
          allowed: false,
          code: 'PROVIDER_PAUSED',
          reason: `Provider pausado: ${opState.providerPauses.join(', ')}.`,
          metadata: { pauses: opState.providerPauses },
        };
      }

      // Circuit breakers abiertos
      if (Array.isArray(opState.openCircuitBreakers) && opState.openCircuitBreakers.length > 0) {
        return {
          allowed: false,
          code: 'PROVIDER_CIRCUIT_OPEN',
          reason: `Circuit breaker abierto para: ${opState.openCircuitBreakers.join(', ')}.`,
          requiredActions: ['wait_circuit_recovery'],
          metadata: { breakers: opState.openCircuitBreakers },
        };
      }

      // Health score critico — bloquear directamente
      if (risk.healthScore != null && risk.healthScore < HEALTH_SCORE_BLOCK_THRESHOLD) {
        return {
          allowed: false,
          code: 'HEALTH_SCORE_CRITICAL',
          reason: `Health score critico (${risk.healthScore}). Envio bloqueado para proteger la cuenta.`,
          metadata: { healthScore: risk.healthScore, threshold: HEALTH_SCORE_BLOCK_THRESHOLD },
        };
      }

      // Health score bajo: no bloquea aqui — la escalada a require_approval
      // la resuelve el routingDecision.service segun el health score del snapshot.

      // Warm-up: no bloquear, pero el Router AI usara tandas reducidas
      // (informacion, no bloqueo — la decision de tandas la toma la IA)

      return { allowed: true };
    },
  };
};
