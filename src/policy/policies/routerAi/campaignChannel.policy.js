'use strict';

/**
 * POLICY — campaignChannel.policy.js
 *
 * Verifica que el tipo de campaña sea compatible con el canal disponible.
 * Free no puede enviar campañas reales (solo simulation/preview).
 *
 * Scope: router_ai.routing
 */

module.exports = function buildCampaignChannelPolicy() {
  return {
    name: 'router_ai.campaign_channel_compatible',
    description: 'Canal debe ser compatible con el tipo de campaña y el plan.',
    async evaluate(ctx) {
      // Free: no puede enviar campañas reales
      if (ctx.plan === 'Free' && ctx.mode !== 'simulation') {
        return {
          allowed: false,
          code: 'PLAN_LIMIT_EXCEEDED',
          reason: 'El plan Free no permite envios reales. Solo simulacion.',
          requiredActions: ['upgrade_plan'],
        };
      }

      // Si el canal no es compatible con el tipo de campaña
      if (ctx.channel && ctx.campaignChannels && ctx.campaignChannels.length > 0) {
        const supported = ctx.campaignChannels.includes(ctx.channel.channelType);
        if (!supported) {
          return {
            allowed: false,
            code: 'CHANNEL_NOT_COMPATIBLE',
            reason: `Canal "${ctx.channel.channelType}" no soporta este tipo de campaña.`,
            metadata: { channelType: ctx.channel.channelType, campaignChannels: ctx.campaignChannels },
          };
        }
      }

      return { allowed: true };
    },
  };
};
