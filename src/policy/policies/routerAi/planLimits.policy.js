'use strict';

/**
 * POLICY — planLimits.policy.js
 *
 * Verifica que el cliente no haya superado los limites del plan
 * para el canal y tipo de envio en cuestion.
 *
 * Scope: router_ai.routing
 */

module.exports = function buildPlanLimitsPolicy() {
  return {
    name: 'router_ai.plan_limits',
    description: 'Limites del plan deben permitir el volumen y tipo de envio.',
    async evaluate(ctx) {
      const limits = ctx.limits;
      if (!limits) return { allowed: true };

      // Destinos programados
      if (
        limits.scheduledDestinationsRemaining != null &&
        limits.scheduledDestinationsRemaining <= 0
      ) {
        return {
          allowed: false,
          code: 'PLAN_LIMIT_EXCEEDED',
          reason: 'Limite de destinos programados del plan agotado.',
          requiredActions: ['upgrade_plan', 'wait_next_period'],
          metadata: { limit: 'scheduledDestinationsRemaining', remaining: 0 },
        };
      }

      // Decisiones AI de routing
      if (
        limits.aiRoutingDecisionsRemaining != null &&
        limits.aiRoutingDecisionsRemaining <= 0 &&
        ctx.mode !== 'simulation'
      ) {
        return {
          allowed: false,
          code: 'PLAN_LIMIT_EXCEEDED',
          reason: 'Limite de decisiones AI de routing agotado en este periodo.',
          requiredActions: ['upgrade_plan', 'wait_next_period'],
          metadata: { limit: 'aiRoutingDecisionsRemaining', remaining: 0 },
        };
      }

      // Templates Meta
      if (
        ctx.channel?.channelType === 'meta' &&
        limits.metaTemplateMessagesRemaining != null &&
        limits.metaTemplateMessagesRemaining <= 0 &&
        ctx.requiresMetaTemplate
      ) {
        return {
          allowed: false,
          code: 'PLAN_LIMIT_EXCEEDED',
          reason: 'Limite de mensajes template Meta agotado.',
          requiredActions: ['upgrade_plan'],
          metadata: { limit: 'metaTemplateMessagesRemaining', remaining: 0 },
        };
      }

      return { allowed: true };
    },
  };
};
