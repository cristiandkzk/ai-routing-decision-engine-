'use strict';

/**
 * SERVICE — modules/policy/policy.engine.js
 *
 * PolicyEngine determinístico. Antes de cualquier acción con riesgo o costo,
 * el caller pregunta: "¿puedo hacer X?" El engine corre todas las políticas
 * registradas para ese `scope` y devuelve:
 *
 *   {
 *     allowed: boolean,
 *     blockedBy: [{ policyName, code, reason, metadata }],
 *     requiredActions: ['request_approval', 'recharge_balance', ...],
 *     policyVersion: 'YYYY-MM-DD',
 *   }
 *
 * La IA NO decide cosas que son reglas duras. Cuando una regla aplica, el
 * engine corta corto y devuelve `allowed: false` con la razón concreta.
 *
 * Spec: Implementaciones/restructuracion.md §"Policy Engine".
 *
 * Cómo definir una política:
 *
 *   policyEngine.register('campaign.publish', {
 *     name: 'campaign.minimum_meta_balance',
 *     async evaluate(context) {
 *       if (context.estimatedCostUSD > context.metaBalance) {
 *         return {
 *           allowed: false,
 *           code: 'INSUFFICIENT_META_BALANCE',
 *           reason: 'Saldo Meta insuficiente para el envío estimado.',
 *           requiredActions: ['recharge_meta_balance'],
 *         };
 *       }
 *       return { allowed: true };
 *     },
 *   });
 *
 * Las políticas se cargan al boot via `modules/policy/policies/index.js`.
 */

const logger = { error: console.error, warn: console.warn, info: console.info };

const POLICY_VERSION = '2026-05-21';
const POLICIES = new Map(); // scope -> Array<policy>

function register(scope, policy) {
  if (!scope || typeof scope !== 'string') throw new Error('scope inválido.');
  if (!policy || typeof policy.evaluate !== 'function' || !policy.name) {
    throw new Error('Policy inválida: requiere `name` y `evaluate(context)`.');
  }
  if (!POLICIES.has(scope)) POLICIES.set(scope, []);
  POLICIES.get(scope).push(Object.freeze({
    name: policy.name,
    description: policy.description || '',
    evaluate: policy.evaluate,
  }));
}

function listForScope(scope) {
  return POLICIES.get(scope) || [];
}

function listAllScopes() {
  return Array.from(POLICIES.keys()).sort();
}

function clearForTests() {
  POLICIES.clear();
}

/**
 * Corre todas las políticas registradas en `scope` con el `context` dado y
 * devuelve un resultado agregado.
 *
 * Comportamiento:
 *   - Se ejecutan TODAS las políticas (no corta corto). Esto permite que el
 *     llamador vea todos los bloqueos de una sola pasada — útil para UX
 *     ("falta saldo Meta Y aprobación").
 *   - Si CUALQUIER política devuelve `allowed: false`, el resultado es no-go.
 *   - Errores en políticas individuales se loguean pero no rompen al
 *     resto: la política rota se considera "blocked" con código
 *     POLICY_ERROR para no permitir un by-pass accidental.
 */
async function evaluate(scope, context = {}) {
  const policies = listForScope(scope);
  const result = {
    allowed: true,
    blockedBy: [],
    requiredActions: new Set(),
    policyVersion: POLICY_VERSION,
    evaluated: policies.length,
  };

  if (!policies.length) {
    return finalize(result);
  }

  // Ejecutamos en paralelo — las políticas no deberían tener side effects.
  const outcomes = await Promise.allSettled(
    policies.map(async (p) => {
      const r = await p.evaluate(context);
      return { policy: p, outcome: r };
    }),
  );

  for (const o of outcomes) {
    if (o.status === 'rejected') {
      logger.error(`[policyEngine] política falló en ${scope}: ${o.reason?.message || o.reason}`);
      result.allowed = false;
      result.blockedBy.push({
        policyName: 'policy_engine.internal_error',
        code: 'POLICY_ERROR',
        reason: 'Una política falló al evaluar (fail-closed).',
        metadata: { error: String(o.reason?.message || o.reason).slice(0, 280) },
      });
      continue;
    }

    const { policy, outcome } = o.value;
    if (!outcome || typeof outcome !== 'object') continue;
    if (outcome.allowed === false) {
      result.allowed = false;
      result.blockedBy.push({
        policyName: policy.name,
        code: outcome.code || 'BLOCKED',
        reason: outcome.reason || 'Bloqueado por política.',
        metadata: outcome.metadata || null,
      });
      for (const a of outcome.requiredActions || []) result.requiredActions.add(a);
    }
  }

  return finalize(result);
}

/**
 * Variante "enforce": evalúa y, si está bloqueado, audita el bloqueo + tira
 * un ForbiddenError listo para que el controller lo propague.
 */
async function enforce(scope, context, { req } = {}) {
  const r = await evaluate(scope, context);
  if (!r.allowed) {
    const err = new Error('Bloqueado por política.');
    err.statusCode = 403;
    err.code = 'POLICY_BLOCKED';
    err.policy = r;
    throw err;
  }
  return r;
}

function finalize(result) {
  return {
    allowed: result.allowed,
    blockedBy: result.blockedBy,
    requiredActions: Array.from(result.requiredActions),
    policyVersion: result.policyVersion,
    evaluated: result.evaluated,
  };
}

module.exports = {
  POLICY_VERSION,
  register,
  listForScope,
  listAllScopes,
  evaluate,
  enforce,
  clearForTests,
};
