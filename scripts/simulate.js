'use strict';

/**
 * Simulacion del AI Routing Decision Engine.
 *
 * No requiere MongoDB ni API keys — todo corre en memoria.
 * Demuestra el comportamiento del motor ante los casos criticos del protocolo.
 *
 * Uso:
 *   npm run simulate
 */

const { registerAll } = require('../src/policy/policies');
const policyEngine    = require('../src/policy/policy.engine');
const fallback        = require('../src/fallback/ruleOnlyFallback.service');

registerAll();

// ── Contexto base que pasa todas las politicas ───────────────────────────────

function ctx(overrides = {}) {
  return {
    clientId:  'client_demo',
    plan:      'Pro',
    mode:      'advisory',
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
      { id: 'd3', optOut: false, pauseState: 'active' },
    ],
    limits: {
      scheduledDestinationsRemaining: 500,
      aiRoutingDecisionsRemaining:    100,
      metaTemplateMessagesRemaining:  200,
      overageEnabled: false,
    },
    risk: { healthScore: 80 },
    operationalState: {
      companyPaused:       false,
      providerPauses:      [],
      openCircuitBreakers: [],
    },
    featureFlags:            { routerAiEnabled: true },
    requiresVerifiedChannel: false,
    baileysUsedAsFallbackForMeta: false,
    ...overrides,
  };
}

// ── Casos de simulacion ──────────────────────────────────────────────────────

const CASOS = [
  {
    nombre:  'Contexto valido — policy permite, ruleOnlyFallback: allow',
    context: ctx(),
  },
  {
    nombre:  'Plan Free en modo advisory — debe bloquear (PLAN_LIMIT_EXCEEDED)',
    context: ctx({ plan: 'Free', mode: 'advisory' }),
  },
  {
    nombre:  'Canal desconectado — debe bloquear (CHANNEL_DISCONNECTED)',
    context: ctx({ channel: { ...ctx().channel, channelStatus: 'disconnected' } }),
  },
  {
    nombre:  'Saldo insuficiente — debe bloquear (CHANNEL_BALANCE_INSUFFICIENT)',
    context: ctx({
      estimatedCostARS: 99999,
      channel: { ...ctx().channel, availableBalanceARS: 100 },
    }),
  },
  {
    nombre:  'Todos los destinos con opt-out — debe bloquear (OPT_OUT)',
    context: ctx({
      destinations: [
        { id: 'd1', optOut: true, pauseState: 'active' },
        { id: 'd2', optOut: true, pauseState: 'active' },
      ],
    }),
  },
  {
    nombre:  'Opt-out parcial — debe permitir (la IA filtra por destino)',
    context: ctx({
      destinations: [
        { id: 'd1', optOut: true,  pauseState: 'active' },
        { id: 'd2', optOut: false, pauseState: 'active' },
      ],
    }),
  },
  {
    nombre:  'Tenant pausado — debe bloquear (TENANT_PAUSED)',
    context: ctx({
      operationalState: { companyPaused: true, providerPauses: [], openCircuitBreakers: [] },
    }),
  },
  {
    nombre:  'Circuit breaker abierto — debe bloquear (PROVIDER_CIRCUIT_OPEN)',
    context: ctx({
      operationalState: { companyPaused: false, providerPauses: [], openCircuitBreakers: ['groq'] },
    }),
  },
  {
    nombre:  'Health score critico (20) — debe bloquear (HEALTH_SCORE_CRITICAL)',
    context: ctx({ risk: { healthScore: 20 } }),
  },
  {
    nombre:  'Health score bajo (50) — permite con riskLevel medium',
    context: ctx({ risk: { healthScore: 50 } }),
  },
  {
    nombre:  'IA no disponible — ruleOnlyFallback con riesgo bajo: allow',
    context: ctx(),
    simularFallback: fallback.REASON.AI_PROVIDER_UNAVAILABLE,
  },
  {
    nombre:  'IA no disponible — ruleOnlyFallback con riesgo alto: block',
    context: ctx({ risk: { healthScore: 30 } }),
    simularFallback: fallback.REASON.AI_PROVIDER_UNAVAILABLE,
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

function icon(decision) {
  if (decision === 'allow')            return '✓';
  if (decision === 'require_approval') return '?';
  return '✗';
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        AI Routing Decision Engine — Simulacion               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  let ok = 0;

  for (const caso of CASOS) {
    const policyResult = await policyEngine.evaluate('router_ai.routing', caso.context);

    let decision, riskLevel, confidence, reasonCodes, fallbackUsed, batches;

    if (caso.simularFallback || !policyResult.allowed) {
      const fb = fallback.decide({
        snapshot:      { ...caso.context, decisionId: 'rdec_sim', destinations: caso.context.destinations },
        policyResult,
        fallbackReason: caso.simularFallback || fallback.REASON.RULE_ONLY_FALLBACK_USED,
      });
      decision     = fb.decision;
      riskLevel    = fb.riskLevel;
      confidence   = fb.confidence;
      reasonCodes  = fb.reasonCodes;
      fallbackUsed = true;
      batches      = fb.batches;
    } else {
      decision     = 'allow';
      riskLevel    = 'low';
      confidence   = 'high';
      reasonCodes  = ['RULES_PASSED'];
      fallbackUsed = false;
      batches      = [];
    }

    console.log(`${'─'.repeat(64)}`);
    console.log(`${icon(decision)}  ${caso.nombre}`);
    console.log(`${'─'.repeat(64)}`);
    console.log(`   decision:     ${decision}`);
    console.log(`   riskLevel:    ${riskLevel}`);
    console.log(`   confidence:   ${confidence}`);
    console.log(`   fallbackUsed: ${fallbackUsed}`);
    console.log(`   policyOk:     ${policyResult.allowed}`);
    if (!policyResult.allowed) {
      console.log(`   blockedBy:    ${policyResult.blockedBy.map(b => b.code).join(', ')}`);
    }
    console.log(`   reasonCodes:  ${reasonCodes.join(', ')}`);
    if (batches.length) {
      console.log(`   batches:      ${batches.length} tanda(s)`);
    }
    console.log();
    ok++;
  }

  console.log(`${'═'.repeat(64)}`);
  console.log(`  ${ok}/${CASOS.length} casos completados sin errores`);
  console.log(`${'═'.repeat(64)}\n`);
}

run().catch((err) => {
  console.error('Error fatal:', err.message);
  process.exit(1);
});
