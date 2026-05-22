'use strict';

const { decide, REASON } = require('../../src/fallback/ruleOnlyFallback.service');

function snapshot(overrides = {}) {
  return {
    decisionId:   'rdec_test',
    clientId:     'client_1',
    mode:         'simulation',
    destinations: [
      { id: 'dest_1', type: 'contact', riskScore: 30, optOut: false, pauseState: 'active', channelType: 'meta' },
      { id: 'dest_2', type: 'contact', riskScore: 40, optOut: false, pauseState: 'active', channelType: 'meta' },
    ],
    channel:           { channelType: 'meta', estimatedCostARS: 1000 },
    risk:              { healthScore: 85 },
    operationalState:  { companyPaused: false },
    estimatedCostARS:  1000,
    ...overrides,
  };
}

function policyOk() {
  return { allowed: true, blockedBy: [], requiredActions: [] };
}

function policyBlocked(code = 'PLAN_NOT_ALLOWED', reason = 'Plan no permite la accion') {
  return { allowed: false, blockedBy: [{ code, reason }], requiredActions: [] };
}

describe('ruleOnlyFallback â€” decide()', () => {

  describe('cuando la policy bloqueo', () => {
    it('devuelve decision = block', () => {
      const result = decide({ snapshot: snapshot(), policyResult: policyBlocked(), fallbackReason: REASON.RULE_ONLY_FALLBACK_USED });
      expect(result.decision).toBe('block');
    });

    it('incluye el reasonCode de la policy en el resultado', () => {
      const result = decide({ snapshot: snapshot(), policyResult: policyBlocked('SALDO_INSUFICIENTE'), fallbackReason: REASON.RULE_ONLY_FALLBACK_USED });
      expect(result.reasonCodes).toContain('SALDO_INSUFICIENTE');
    });

    it('marca todos los destinos como bloqueados', () => {
      const result = decide({ snapshot: snapshot(), policyResult: policyBlocked(), fallbackReason: REASON.RULE_ONLY_FALLBACK_USED });
      expect(result.blockedDestinations).toHaveLength(2);
      result.perDestinationDecisions.forEach(d => expect(d.decision).toBe('block'));
    });

    it('tiene _fallback = true', () => {
      const result = decide({ snapshot: snapshot(), policyResult: policyBlocked(), fallbackReason: REASON.RULE_ONLY_FALLBACK_USED });
      expect(result._fallback).toBe(true);
    });
  });

  describe('riesgo bajo (healthScore >= 70)', () => {
    it('devuelve decision = allow', () => {
      const result = decide({ snapshot: snapshot({ risk: { healthScore: 85 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.decision).toBe('allow');
    });

    it('genera tandas conservadoras (max 5 destinos por tanda)', () => {
      const manyDests = Array.from({ length: 12 }, (_, i) => ({
        id: `dest_${i}`, type: 'contact', riskScore: 20, optOut: false, pauseState: 'active', channelType: 'meta',
      }));
      const result = decide({ snapshot: snapshot({ destinations: manyDests }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.decision).toBe('allow');
      expect(result.batches.length).toBe(3); // 12 / 5 = 3 tandas
      result.batches.forEach(b => expect(b.destinations.length).toBeLessThanOrEqual(5));
    });

    it('incluye LOW_RISK_RULES_PASSED en reasonCodes', () => {
      const result = decide({ snapshot: snapshot({ risk: { healthScore: 90 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.reasonCodes).toContain(REASON.LOW_RISK_RULES_PASSED);
    });

    it('confidence = low (la IA no valido la decision)', () => {
      const result = decide({ snapshot: snapshot({ risk: { healthScore: 80 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.confidence).toBe('low');
    });
  });

  describe('riesgo medio (50 <= healthScore < 70)', () => {
    it('devuelve decision = require_approval', () => {
      const result = decide({ snapshot: snapshot({ risk: { healthScore: 60 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.decision).toBe('require_approval');
    });

    it('requiresApproval = true', () => {
      const result = decide({ snapshot: snapshot({ risk: { healthScore: 60 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.requiresApproval).toBe(true);
    });

    it('incluye request_approval en requiredActions', () => {
      const result = decide({ snapshot: snapshot({ risk: { healthScore: 60 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.requiredActions).toContain('request_approval');
    });
  });

  describe('riesgo alto (healthScore < 50)', () => {
    it('devuelve decision = block', () => {
      const result = decide({ snapshot: snapshot({ risk: { healthScore: 30 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.decision).toBe('block');
    });

    it('incluye HIGH_RISK_BLOCKED en reasonCodes', () => {
      const result = decide({ snapshot: snapshot({ risk: { healthScore: 30 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.reasonCodes).toContain(REASON.HIGH_RISK_BLOCKED);
    });
  });

  describe('filtra opt-out y pausados antes de calcular', () => {
    it('excluye destinos con optOut = true de las tandas', () => {
      const dests = [
        { id: 'a', type: 'contact', riskScore: 20, optOut: true,  pauseState: 'active', channelType: 'meta' },
        { id: 'b', type: 'contact', riskScore: 20, optOut: false, pauseState: 'active', channelType: 'meta' },
      ];
      const result = decide({ snapshot: snapshot({ destinations: dests, risk: { healthScore: 85 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.decision).toBe('allow');
      const allDests = result.batches.flatMap(b => b.destinations);
      expect(allDests).not.toContain('a');
      expect(allDests).toContain('b');
    });

    it('excluye destinos pausados de las tandas', () => {
      const dests = [
        { id: 'a', type: 'contact', riskScore: 20, optOut: false, pauseState: 'paused', channelType: 'meta' },
        { id: 'b', type: 'contact', riskScore: 20, optOut: false, pauseState: 'active', channelType: 'meta' },
      ];
      const result = decide({ snapshot: snapshot({ destinations: dests, risk: { healthScore: 85 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      const allDests = result.batches.flatMap(b => b.destinations);
      expect(allDests).not.toContain('a');
      expect(allDests).toContain('b');
    });

    it('si todos los destinos tienen opt-out, devuelve batches vacios', () => {
      const dests = [
        { id: 'a', type: 'contact', riskScore: 20, optOut: true, pauseState: 'active', channelType: 'meta' },
      ];
      const result = decide({ snapshot: snapshot({ destinations: dests, risk: { healthScore: 85 } }), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.batches).toHaveLength(0);
    });
  });

  describe('estructura del output', () => {
    it('siempre incluye todos los campos requeridos por el schema', () => {
      const result = decide({ snapshot: snapshot(), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      const required = ['decisionId', 'decision', 'riskLevel', 'requiresApproval', 'expiresAt',
        'summary', 'confidence', 'reasonCodes', 'rulesApplied', 'batches',
        'perDestinationDecisions', 'blockedDestinations', 'requiredActions', 'balanceReservation'];
      for (const field of required) {
        expect(result).toHaveProperty(field);
      }
    });

    it('expiresAt es una fecha futura', () => {
      const result = decide({ snapshot: snapshot(), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('rulesApplied incluye rule_only_fallback', () => {
      const result = decide({ snapshot: snapshot(), policyResult: policyOk(), fallbackReason: REASON.AI_PROVIDER_UNAVAILABLE });
      expect(result.rulesApplied).toContain('rule_only_fallback');
    });
  });

});
