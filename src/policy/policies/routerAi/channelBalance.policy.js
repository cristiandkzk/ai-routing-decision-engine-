'use strict';

/**
 * POLICY — channelBalance.policy.js
 *
 * Verifica que el saldo del canal sea suficiente para el costo estimado.
 * Universal — el estimatedCostARS ya viene normalizado en el snapshot.
 *
 * Scope: router_ai.routing
 */

module.exports = function buildChannelBalancePolicy() {
  return {
    name: 'router_ai.channel_balance_sufficient',
    description: 'Saldo del canal debe cubrir el costo estimado del envio.',
    async evaluate(ctx) {
      const ch = ctx.channel;
      if (!ch) return { allowed: true };

      // Solo aplica si hay costo estimado y el canal expone saldo
      const estimatedCost = ctx.estimatedCostARS || 0;
      if (estimatedCost <= 0) return { allowed: true };

      // availableBalanceARS viene del snapshot universal del canal (informativo)
      const available = ch.availableBalanceARS;
      if (available == null) return { allowed: true }; // canal no expone saldo, no bloquear

      if (available < estimatedCost) {
        return {
          allowed: false,
          code: 'CHANNEL_BALANCE_INSUFFICIENT',
          reason: `Saldo insuficiente en canal "${ch.channelType}". Disponible: ${available} ARS, requerido: ${estimatedCost} ARS.`,
          requiredActions: ['recharge_channel_balance'],
          metadata: {
            channelType:    ch.channelType,
            availableARS:   available,
            estimatedARS:   estimatedCost,
          },
        };
      }

      return { allowed: true };
    },
  };
};
