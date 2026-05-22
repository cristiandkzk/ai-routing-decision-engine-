'use strict';

const { validate, SCHEMA_VERSION } = require('../../src/schema/routerDecision.schema');

// Output valido minimo que pasa todas las validaciones
function validOutput(overrides = {}) {
  return {
    decisionId:    'rdec_test123',
    schemaVersion: SCHEMA_VERSION,
    decision:      'allow',
    riskLevel:     'low',
    estimatedCostARS:   0,
    estimatedAiCostUSD: 0.002,
    requiresApproval:   false,
    expiresAt:     new Date(Date.now() + 3600 * 1000).toISOString(),
    summary:       'Test decision',
    confidence:    'medium',
    reasonCodes:   ['RULES_PASSED'],
    rulesApplied:  ['policy_passed'],
    batches:       [],
    perDestinationDecisions: [],
    blockedDestinations:     [],
    requiredActions:         [],
    balanceReservation: { required: false, estimatedAmountARS: 0 },
    ...overrides,
  };
}

describe('routerDecision.schema â€” validate()', () => {

  describe('output valido', () => {
    it('acepta un output minimo correcto', () => {
      const result = validate(validOutput());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.normalized).not.toBeNull();
    });

    it('normaliza estimatedCostARS a number', () => {
      const result = validate(validOutput({ estimatedCostARS: '500' }));
      // string no es number â€” debe fallar
      expect(result.valid).toBe(false);
    });

    it('normaliza requiresApproval a boolean', () => {
      const result = validate(validOutput({ requiresApproval: false }));
      expect(result.valid).toBe(true);
      expect(result.normalized.requiresApproval).toBe(false);
    });

    it('recorta summary a 500 chars', () => {
      const long = 'x'.repeat(600);
      const result = validate(validOutput({ summary: long }));
      expect(result.valid).toBe(true);
      expect(result.normalized.summary.length).toBe(500);
    });

    it('acepta todos los valores validos de decision', () => {
      for (const d of ['allow', 'block', 'require_approval', 'split']) {
        expect(validate(validOutput({ decision: d })).valid).toBe(true);
      }
    });

    it('acepta todos los valores validos de riskLevel', () => {
      for (const r of ['low', 'medium', 'high', 'critical']) {
        expect(validate(validOutput({ riskLevel: r })).valid).toBe(true);
      }
    });
  });

  describe('campos obligatorios faltantes', () => {
    const required = [
      'decisionId', 'schemaVersion', 'decision', 'riskLevel',
      'estimatedCostARS', 'estimatedAiCostUSD', 'requiresApproval',
      'expiresAt', 'summary', 'confidence',
    ];

    for (const field of required) {
      it(`rechaza output sin "${field}"`, () => {
        const input = validOutput();
        delete input[field];
        const result = validate(input);
        expect(result.valid).toBe(false);
        expect(result.normalized).toBeNull();
      });
    }
  });

  describe('valores invalidos en enums', () => {
    it('rechaza decision invalida', () => {
      const result = validate(validOutput({ decision: 'maybe' }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('decision'))).toBe(true);
    });

    it('rechaza riskLevel invalido', () => {
      const result = validate(validOutput({ riskLevel: 'extreme' }));
      expect(result.valid).toBe(false);
    });

    it('rechaza confidence invalido', () => {
      const result = validate(validOutput({ confidence: 'very_high' }));
      expect(result.valid).toBe(false);
    });
  });

  describe('expiresAt', () => {
    it('rechaza expiresAt no ISO', () => {
      const result = validate(validOutput({ expiresAt: 'manana a las 3' }));
      expect(result.valid).toBe(false);
    });

    it('acepta expiresAt en el pasado (la expiracion la verifica el Business Validator, no el schema)', () => {
      const result = validate(validOutput({ expiresAt: '2020-01-01T00:00:00.000Z' }));
      expect(result.valid).toBe(true);
    });
  });

  describe('balanceReservation', () => {
    it('rechaza balanceReservation sin required', () => {
      const result = validate(validOutput({ balanceReservation: { estimatedAmountARS: 0 } }));
      expect(result.valid).toBe(false);
    });

    it('rechaza balanceReservation sin estimatedAmountARS', () => {
      const result = validate(validOutput({ balanceReservation: { required: false } }));
      expect(result.valid).toBe(false);
    });

    it('rechaza balanceReservation que no es objeto', () => {
      const result = validate(validOutput({ balanceReservation: null }));
      expect(result.valid).toBe(false);
    });
  });

  describe('batches', () => {
    it('acepta batches vacios', () => {
      const result = validate(validOutput({ batches: [] }));
      expect(result.valid).toBe(true);
    });

    it('valida cada campo de un batch', () => {
      const batch = {
        batchNumber: 1,
        channel: 'meta',
        provider: 'meta',
        scheduledDelayMinutes: 0,
        scheduledFor: new Date().toISOString(),
        destinations: ['dest_1'],
      };
      const result = validate(validOutput({ batches: [batch] }));
      expect(result.valid).toBe(true);
    });

    it('rechaza batch con channel invalido', () => {
      const batch = {
        batchNumber: 1,
        channel: 'fax',
        provider: 'fax',
        scheduledDelayMinutes: 0,
        scheduledFor: new Date().toISOString(),
        destinations: [],
      };
      const result = validate(validOutput({ batches: [batch] }));
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('channel'))).toBe(true);
    });
  });

  describe('output no es objeto', () => {
    it('rechaza null', () => {
      expect(validate(null).valid).toBe(false);
    });

    it('rechaza string', () => {
      expect(validate('{"decision":"allow"}').valid).toBe(false);
    });

    it('rechaza array', () => {
      expect(validate([]).valid).toBe(false);
    });
  });

});
