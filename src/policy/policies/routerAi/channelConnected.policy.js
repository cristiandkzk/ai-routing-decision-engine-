'use strict';

/**
 * POLICY — channelConnected.policy.js
 *
 * Verifica que el canal este conectado y verificado.
 * Universal — funciona para Meta, Instagram, MercadoLibre, Telegram, etc.
 * Cada canal mapea su estado al snapshot universal antes de llegar aca.
 *
 * Scope: router_ai.routing
 */

module.exports = function buildChannelConnectedPolicy() {
  return {
    name: 'router_ai.channel_connected',
    description: 'Canal debe estar conectado y verificado para envios oficiales.',
    async evaluate(ctx) {
      const ch = ctx.channel;
      if (!ch) return { allowed: true }; // sin canal en contexto, otra policy lo maneja

      if (ch.channelStatus === 'disconnected') {
        return {
          allowed: false,
          code: 'CHANNEL_DISCONNECTED',
          reason: `Canal "${ch.channelType}" esta desconectado.`,
          requiredActions: ['reconnect_channel'],
          metadata: { channelType: ch.channelType },
        };
      }

      if (ch.channelStatus === 'degraded') {
        return {
          allowed: false,
          code: 'CHANNEL_DEGRADED',
          reason: `Canal "${ch.channelType}" esta degradado. Verificar estado antes de enviar.`,
          requiredActions: ['check_channel_status'],
          metadata: { channelType: ch.channelType },
        };
      }

      // Para funciones oficiales (templates, broadcasts) el canal debe estar verificado
      if (ch.channelVerified === false && ctx.requiresVerifiedChannel) {
        return {
          allowed: false,
          code: 'CHANNEL_NOT_VERIFIED',
          reason: `Canal "${ch.channelType}" no esta verificado. Funciones oficiales bloqueadas.`,
          requiredActions: ['verify_channel'],
          metadata: { channelType: ch.channelType },
        };
      }

      return { allowed: true };
    },
  };
};
