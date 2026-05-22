'use strict';

/**
 * POLICY — optOut.policy.js
 *
 * Bloquea el routing si alguno de los destinos tiene opt-out activo.
 * Los destinos con opt-out van a blockedDestinations, no bloquean la
 * campaña completa — a menos que TODOS los destinos esten en opt-out.
 *
 * Scope: router_ai.routing
 */

module.exports = function buildOptOutPolicy() {
  return {
    name: 'router_ai.opt_out',
    description: 'Destinos con opt-out activo no pueden recibir mensajes iniciados por la empresa.',
    async evaluate(ctx) {
      const destinations = ctx.destinations || [];
      if (!destinations.length) return { allowed: true };

      const optOutIds = destinations
        .filter((d) => d.optOut === true)
        .map((d) => d.id || d.destinationId);

      if (!optOutIds.length) return { allowed: true };

      const activeDestinations = destinations.filter((d) => !d.optOut);

      // Si TODOS los destinos estan en opt-out, bloquear la campaña completa
      if (activeDestinations.length === 0) {
        return {
          allowed: false,
          code: 'OPT_OUT',
          reason: 'Todos los destinos tienen opt-out activo. Campaña bloqueada.',
          metadata: { optOutCount: optOutIds.length },
        };
      }

      // Si solo algunos tienen opt-out, no bloquear — el Router AI los excluye
      // Esta informacion se incluye en el contexto para que la IA los ponga
      // en blockedDestinations del output. No es un bloqueo total.
      return { allowed: true };
    },
  };
};
