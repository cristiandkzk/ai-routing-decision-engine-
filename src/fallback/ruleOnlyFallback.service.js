'use strict';

/**
 * SERVICE — ruleOnlyFallback.service.js
 *
 * Decision conservadora cuando la IA no esta disponible (timeout, schema
 * invalido, circuit breaker abierto). No llama ningun provider externo.
 *
 * Logica:
 *   - Reglas duras bloquean -> block
 *   - Riesgo bajo + reglas OK -> allow con tandas minimas y delays conservadores
 *   - Riesgo medio -> require_approval
 *   - Riesgo alto/critico -> block
 *
 * Spec: Implementaciones/Router AI Engine Implementacion.md §Fase 2.2
 */

const { nanoid } = require('nanoid');

const REASON = Object.freeze({
  RULE_ONLY_FALLBACK_USED:        'RULE_ONLY_FALLBACK_USED',
  AI_PROVIDER_UNAVAILABLE:        'AI_PROVIDER_UNAVAILABLE',
  PROVIDER_CIRCUIT_OPEN:          'PROVIDER_CIRCUIT_OPEN',
  SCHEMA_INVALID:                 'SCHEMA_INVALID',
  LOW_RISK_RULES_PASSED:          'LOW_RISK_RULES_PASSED',
  MEDIUM_RISK_APPROVAL_REQUIRED:  'MEDIUM_RISK_APPROVAL_REQUIRED',
  HIGH_RISK_BLOCKED:              'HIGH_RISK_BLOCKED',
});

// TTL conservador para decisiones fallback (30 minutos)
const FALLBACK_TTL_MS = 30 * 60 * 1000;

// Delay entre tandas en modo fallback (minutos)
const CONSERVATIVE_BATCH_DELAY_MINUTES = 10;

// Max destinos por tanda en modo fallback
const CONSERVATIVE_BATCH_SIZE = 5;

/**
 * Genera una decision conservadora sin llamar a la IA.
 *
 * @param {object} params
 * @param {object} params.snapshot      — CampaignRoutingSnapshot
 * @param {object} params.policyResult  — resultado del policy engine (ya evaluado)
 * @param {string} params.fallbackReason — razon del fallback (REASON.*)
 * @returns {object} decision con la misma forma que el output del schema validator
 */
function decide({ snapshot, policyResult, fallbackReason = REASON.RULE_ONLY_FALLBACK_USED }) {
  const decisionId  = snapshot?.decisionId || `rdec_fallback_${nanoid(12)}`;
  const expiresAt   = new Date(Date.now() + FALLBACK_TTL_MS);
  const destinations = (snapshot?.destinations || []).filter((d) => !d.optOut && d.pauseState !== 'paused');
  const riskLevel   = snapshot?.risk?.healthScore < 50 ? 'high'
    : snapshot?.risk?.healthScore < 70 ? 'medium'
    : 'low';

  const baseReasonCodes = [REASON.RULE_ONLY_FALLBACK_USED, fallbackReason].filter(Boolean);

  // 1. Policy engine ya bloqueo
  if (policyResult && !policyResult.allowed) {
    const codes = policyResult.blockedBy.map((b) => b.code);
    return _build({
      decisionId,
      decision:         'block',
      riskLevel:        'high',
      reasonCodes:      [...baseReasonCodes, ...codes],
      summary:          `Bloqueado por politica: ${policyResult.blockedBy.map((b) => b.reason).join('; ')}`,
      requiredActions:  policyResult.requiredActions || [],
      batches:          [],
      perDestination:   destinations.map((d) => _blockedDest(d, codes)),
      blockedDests:     destinations.map((d) => d.id || d.destinationId),
      balanceReservation: { required: false, estimatedAmountARS: 0 },
      confidence:       'high',
      expiresAt,
    });
  }

  // 2. Riesgo alto o critico -> block
  if (riskLevel === 'high' || riskLevel === 'critical') {
    return _build({
      decisionId,
      decision:    'block',
      riskLevel,
      reasonCodes: [...baseReasonCodes, REASON.HIGH_RISK_BLOCKED],
      summary:     'Bloqueado en modo fallback: riesgo alto sin confirmacion de IA.',
      requiredActions: ['request_approval'],
      batches:     [],
      perDestination: destinations.map((d) => _blockedDest(d, [REASON.HIGH_RISK_BLOCKED])),
      blockedDests:   destinations.map((d) => d.id || d.destinationId),
      balanceReservation: { required: false, estimatedAmountARS: 0 },
      confidence:  'high',
      expiresAt,
    });
  }

  // 3. Riesgo medio -> require_approval
  if (riskLevel === 'medium') {
    return _build({
      decisionId,
      decision:    'require_approval',
      riskLevel,
      reasonCodes: [...baseReasonCodes, REASON.MEDIUM_RISK_APPROVAL_REQUIRED],
      summary:     'Aprobacion requerida en modo fallback: riesgo medio sin confirmacion de IA.',
      requiredActions: ['request_approval'],
      batches:     _conservativeBatches(destinations, snapshot?.channel?.channelType),
      perDestination: destinations.map((d) => _allowedDest(d, [REASON.MEDIUM_RISK_APPROVAL_REQUIRED])),
      blockedDests:   [],
      balanceReservation: { required: false, estimatedAmountARS: snapshot?.estimatedCostARS || 0 },
      confidence:  'low',
      expiresAt,
    });
  }

  // 4. Riesgo bajo + reglas OK -> allow con tandas conservadoras
  return _build({
    decisionId,
    decision:    'allow',
    riskLevel:   'low',
    reasonCodes: [...baseReasonCodes, REASON.LOW_RISK_RULES_PASSED],
    summary:     'Permitido en modo fallback con tandas conservadoras. La IA no estaba disponible.',
    requiredActions: [],
    batches:     _conservativeBatches(destinations, snapshot?.channel?.channelType),
    perDestination: destinations.map((d) => _allowedDest(d, [REASON.LOW_RISK_RULES_PASSED])),
    blockedDests:   [],
    balanceReservation: { required: false, estimatedAmountARS: snapshot?.estimatedCostARS || 0 },
    confidence:  'low',
    expiresAt,
  });
}

// ── Helpers internos ──────────────────────────────────────────────────────

function _build({
  decisionId, decision, riskLevel, reasonCodes, summary,
  requiredActions, batches, perDestination, blockedDests,
  balanceReservation, confidence, expiresAt,
}) {
  return {
    decisionId,
    schemaVersion:          'router_ai_output_v1',
    decision,
    riskLevel,
    estimatedCostARS:       0,
    estimatedAiCostUSD:     0,
    requiresApproval:       decision === 'require_approval',
    expiresAt,
    summary,
    confidence,
    reasonCodes,
    rulesApplied:           ['rule_only_fallback'],
    batches,
    perDestinationDecisions: perDestination,
    blockedDestinations:    blockedDests,
    requiredActions,
    balanceReservation,
    _fallback: true,
  };
}

function _conservativeBatches(destinations, channelType) {
  if (!destinations.length) return [];
  const batches = [];
  const chunks = _chunk(destinations, CONSERVATIVE_BATCH_SIZE);
  const now = new Date();
  for (let i = 0; i < chunks.length; i++) {
    const delayMin = i * CONSERVATIVE_BATCH_DELAY_MINUTES;
    batches.push({
      batchNumber:           i + 1,
      channel:               channelType || 'meta',
      provider:              channelType || 'meta',
      scheduledDelayMinutes: delayMin,
      scheduledFor:          new Date(now.getTime() + delayMin * 60 * 1000).toISOString(),
      destinations:          chunks[i].map((d) => d.id || d.destinationId),
    });
  }
  return batches;
}

function _chunk(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function _blockedDest(d, codes) {
  return { destinationId: d.id || d.destinationId, decision: 'block', channel: 'none', reasonCodes: codes };
}

function _allowedDest(d, codes) {
  return { destinationId: d.id || d.destinationId, decision: 'allow', channel: d.channelType || 'meta', reasonCodes: codes };
}

module.exports = { decide, REASON };
