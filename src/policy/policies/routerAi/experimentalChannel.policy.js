'use strict';

/**
 * POLICY — baileysExperimental.policy.js
 *
 * Reglas duras para el canal Baileys experimental.
 * Baileys solo puede usarse en advisory/shadow, nunca en enforced.
 * Requiere habilitacion ROOT + terminos aceptados por el tenant.
 *
 * Spec: Implementaciones/Router AI.md §"Aclaracion obligatoria sobre Baileys"
 *
 * Scope: router_ai.routing
 */

module.exports = function buildBaileysExperimentalPolicy() {
  return {
    name: 'router_ai.baileys_experimental_gates',
    description: 'Reglas duras para el canal Baileys experimental.',
    async evaluate(ctx) {
      const ch = ctx.channel;
      if (!ch || ch.channelType !== 'baileys') return { allowed: true };

      const flags = ctx.featureFlags || {};

      // Requiere habilitacion ROOT
      if (!flags.baileysExperimentalEnabled) {
        return {
          allowed: false,
          code: 'BAILEYS_NOT_ENABLED',
          reason: 'Baileys experimental no esta habilitado para este tenant. Requiere activacion ROOT.',
          metadata: {},
        };
      }

      // Requiere aceptacion de terminos por el tenant
      if (!flags.baileysTermsAccepted) {
        return {
          allowed: false,
          code: 'BAILEYS_TERMS_NOT_ACCEPTED',
          reason: 'El tenant no acepto los terminos de uso experimental de Baileys.',
          requiredActions: ['accept_baileys_terms'],
          metadata: {},
        };
      }

      // Terminos vencidos o version cambiada
      if (flags.baileysTermsExpired) {
        return {
          allowed: false,
          code: 'BAILEYS_TERMS_EXPIRED',
          reason: 'Los terminos de Baileys experimental vencieron o cambiaron. Se requiere nueva aceptacion.',
          requiredActions: ['accept_baileys_terms'],
          metadata: {},
        };
      }

      // Nunca enforced para Baileys
      if (ctx.mode === 'enforced') {
        return {
          allowed: false,
          code: 'BAILEYS_ENFORCED_NOT_ALLOWED',
          reason: 'Baileys experimental no puede operar en modo enforced.',
          metadata: { mode: ctx.mode },
        };
      }

      // Baileys no puede usarse para evadir costo Meta
      if (ctx.baileysUsedAsFallbackForMeta) {
        return {
          allowed: false,
          code: 'BAILEYS_FALLBACK_NOT_ALLOWED',
          reason: 'Baileys no puede usarse como fallback automatico para reducir costo Meta.',
          metadata: {},
        };
      }

      return { allowed: true };
    },
  };
};
