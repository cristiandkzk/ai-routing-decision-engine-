'use strict';

// Tests de integracion del Policy Engine para el scope router_ai.routing.
// No requieren MongoDB â€” las politicas son funciones puras.
// Lo que verificamos: que cada politica bloquea lo que promete bloquear,
// y que el engine las evalua en orden correcto.

const policyEngine = require('../../src/policy/policy.engine');
const { registerAll } = require('../../src/policy/policies');

beforeAll(() => {
  registerAll();
});

// Contexto base que pasa todas las politicas
function ctxOk(overrides = {}) {
  return {
    plan:    'Pro',
    mode:    'advisory',
    channel: {
      channelType:         'meta',
      channelStatus:       'connected',
      channelVerified:     true,
      availableBalanceARS: 50000,
    },
    estimatedCostARS: 1000,
    destinations: [
      { id: 'd1', optOut: false, pauseState: 'active' },
      { id: 'd2', optOut: false, pauseState: 'active' },
    ],
    limits: {
      scheduledDestinationsRemaining:    500,
      aiRoutingDecisionsRemaining:       100,
      metaTemplateMessagesRemaining:     200,
      overageEnabled:                    false,
    },
    risk: { healthScore: 80 },
    operationalState: {
      companyPaused:       false,
      providerPauses:      [],
      openCircuitBreakers: [],
    },
    featureFlags:            { routerAiEnabled: true },
    requiresVerifiedChannel: false,
    requiresMetaTemplate:    false,
    baileysUsedAsFallbackForMeta: false,
    ...overrides,
  };
}

describe('Policy Engine â€” scope router_ai.routing', () => {

  describe('contexto valido', () => {
    it('permite todo cuando el contexto es correcto', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk());
      expect(result.allowed).toBe(true);
    });
  });

  describe('plan Free', () => {
    it('bloquea en modo advisory', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({ plan: 'Free', mode: 'advisory' }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'PLAN_LIMIT_EXCEEDED')).toBe(true);
    });

    it('permite en modo simulation', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({ plan: 'Free', mode: 'simulation' }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('canal desconectado', () => {
    it('bloquea con CHANNEL_DISCONNECTED', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        channel: { ...ctxOk().channel, channelStatus: 'disconnected' },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'CHANNEL_DISCONNECTED')).toBe(true);
    });

    it('bloquea canal degradado con CHANNEL_DEGRADED', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        channel: { ...ctxOk().channel, channelStatus: 'degraded' },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'CHANNEL_DEGRADED')).toBe(true);
    });
  });

  describe('canal no verificado', () => {
    it('bloquea funciones oficiales si requiresVerifiedChannel = true', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        channel: { ...ctxOk().channel, channelVerified: false },
        requiresVerifiedChannel: true,
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'CHANNEL_NOT_VERIFIED')).toBe(true);
    });

    it('permite si requiresVerifiedChannel = false aunque no este verificado', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        channel: { ...ctxOk().channel, channelVerified: false },
        requiresVerifiedChannel: false,
      }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('saldo insuficiente', () => {
    it('bloquea cuando estimatedCostARS > availableBalanceARS', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        estimatedCostARS: 99999,
        channel: { ...ctxOk().channel, availableBalanceARS: 100 },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'CHANNEL_BALANCE_INSUFFICIENT')).toBe(true);
    });

    it('permite cuando el saldo es suficiente', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        estimatedCostARS: 100,
        channel: { ...ctxOk().channel, availableBalanceARS: 50000 },
      }));
      expect(result.allowed).toBe(true);
    });

    it('permite cuando estimatedCostARS = 0 aunque no haya saldo', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        estimatedCostARS: 0,
        channel: { ...ctxOk().channel, availableBalanceARS: 0 },
      }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('opt-out', () => {
    it('bloquea si TODOS los destinos tienen opt-out', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        destinations: [
          { id: 'd1', optOut: true,  pauseState: 'active' },
          { id: 'd2', optOut: true,  pauseState: 'active' },
        ],
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'OPT_OUT')).toBe(true);
    });

    it('permite si al menos un destino no tiene opt-out (parcial lo maneja la IA)', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        destinations: [
          { id: 'd1', optOut: true,  pauseState: 'active' },
          { id: 'd2', optOut: false, pauseState: 'active' },
        ],
      }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('limites del plan', () => {
    it('bloquea cuando scheduledDestinationsRemaining = 0', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        limits: { ...ctxOk().limits, scheduledDestinationsRemaining: 0 },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'PLAN_LIMIT_EXCEEDED')).toBe(true);
    });

    it('bloquea aiRoutingDecisionsRemaining = 0 en modo advisory', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        mode:   'advisory',
        limits: { ...ctxOk().limits, aiRoutingDecisionsRemaining: 0 },
      }));
      expect(result.allowed).toBe(false);
    });

    it('no bloquea aiRoutingDecisionsRemaining = 0 en modo simulation', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        mode:   'simulation',
        limits: { ...ctxOk().limits, aiRoutingDecisionsRemaining: 0 },
      }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('riskGates', () => {
    it('bloquea si companyPaused = true', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        operationalState: { companyPaused: true, providerPauses: [], openCircuitBreakers: [] },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'TENANT_PAUSED')).toBe(true);
    });

    it('bloquea si hay circuit breakers abiertos', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        operationalState: {
          companyPaused:       false,
          providerPauses:      [],
          openCircuitBreakers: ['groq'],
        },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'PROVIDER_CIRCUIT_OPEN')).toBe(true);
    });

    it('bloquea si healthScore < 30', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        risk: { healthScore: 20 },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'HEALTH_SCORE_CRITICAL')).toBe(true);
    });

    it('permite con healthScore = 31', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        risk: { healthScore: 31 },
      }));
      expect(result.allowed).toBe(true);
    });
  });

  describe('canal baileys experimental', () => {
    it('bloquea baileys en modo enforced', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        mode:    'enforced',
        channel: { ...ctxOk().channel, channelType: 'baileys', channelStatus: 'connected', channelVerified: false },
        featureFlags: { routerAiEnabled: true, baileysExperimentalEnabled: true, baileysTermsAccepted: true },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'BAILEYS_ENFORCED_NOT_ALLOWED')).toBe(true);
    });

    it('bloquea baileys si baileysExperimentalEnabled = false', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        mode:    'advisory',
        channel: { ...ctxOk().channel, channelType: 'baileys', channelStatus: 'connected', channelVerified: false },
        featureFlags: { routerAiEnabled: true, baileysExperimentalEnabled: false },
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'BAILEYS_NOT_ENABLED')).toBe(true);
    });

    it('bloquea baileys usado como fallback de meta', async () => {
      const result = await policyEngine.evaluate('router_ai.routing', ctxOk({
        mode:    'advisory',
        channel: { ...ctxOk().channel, channelType: 'baileys', channelStatus: 'connected', channelVerified: false },
        featureFlags: { routerAiEnabled: true, baileysExperimentalEnabled: true, baileysTermsAccepted: true },
        baileysUsedAsFallbackForMeta: true,
      }));
      expect(result.allowed).toBe(false);
      expect(result.blockedBy.some(b => b.code === 'BAILEYS_FALLBACK_NOT_ALLOWED')).toBe(true);
    });
  });

});
