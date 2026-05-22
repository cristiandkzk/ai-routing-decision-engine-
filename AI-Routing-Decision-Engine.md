# AI Routing Decision Engine

Una arquitectura practica para decidir envios, automatizaciones y acciones con
IA sin dejar que la IA tenga la ultima palabra.

La idea central:

```txt
La IA propone.
La plataforma valida.
El executor solo ejecuta decisiones validadas.
```

Este documento sirve para plataformas SaaS, CRMs, herramientas de mensajeria,
marketplaces, sistemas de marketing, asistentes internos o cualquier producto
que use IA para decidir acciones con costo, riesgo o impacto operativo.

## Problema

Muchas plataformas conectan IA directo a acciones:

```txt
usuario pide algo
  -> modelo decide
  -> sistema ejecuta
```

Ese flujo es peligroso cuando la accion puede:

- generar costo variable;
- enviar mensajes por canales pagos;
- usar canales sensibles o no oficiales;
- publicar contenido;
- afectar reputacion del negocio;
- violar limites de plan;
- duplicar envios;
- ignorar opt-out o consentimiento;
- requerir aprobacion humana.

La solucion es separar decision, validacion y ejecucion.

## Objetivo

Construir un motor de decisiones que:

- reduzca costo de IA;
- reduzca costo de APIs externas;
- evite ejecuciones riesgosas;
- audite por que se tomo cada decision;
- use reglas deterministicas antes que IA;
- permita aprobaciones humanas;
- soporte fallback conservador;
- pueda operar en modo simulacion antes de afectar produccion.

## Principio

No usar IA si una regla, cache o herramienta deterministica puede resolver bien.

Orden recomendado:

```txt
Rule Engine / Policy Engine
  -> Decision Cache
  -> AI Router si aporta valor
  -> Schema Validator
  -> Business Validator
  -> Approval Workflow
  -> Executor
  -> Audit / Billing / Outbox
```

Nunca:

```txt
AI Router -> Executor directo
```

## Componentes

### 1. Rule Engine / Policy Engine

Ejecuta reglas duras antes de llamar al modelo.

Ejemplos:

```txt
plan no permite la accion -> block
saldo insuficiente -> block
usuario sin permiso -> block
canal desconectado -> block
destino sin consentimiento -> block
opt-out activo -> block
canal no oficial no habilitado -> block
feature flag apagada -> block
approval requerida y no aprobada -> block
```

La IA no debe poder ignorar estas reglas.

### 2. AI Router

Optimiza dentro de lo permitido.

Puede decidir:

```txt
tandas
demoras
orden recomendado
riesgo
explicacion
si conviene pedir aprobacion
si conviene pausar
si conviene usar una alternativa mas barata
```

No puede decidir:

```txt
ignorar limites del plan
usar un canal no habilitado
enviar sin saldo
enviar a opt-out
ejecutar sin aprobacion requerida
usar un canal experimental como fallback automatico
```

### 3. Schema Validator

Valida la salida de IA contra un JSON Schema estricto.

Regla:

```txt
si el schema falla:
  no ejecutar
  reintentar como maximo una vez
  si vuelve a fallar, usar fallback conservador
```

### 4. Business Validator

Vuelve a validar despues de la IA.

Debe chequear:

```txt
plan
limites
saldo
reserva de costo
permisos
feature flags
estado del canal
estado del proveedor
consentimiento
opt-out
horarios permitidos
reputacion de links
aprobaciones
circuit breakers
idempotencia
expiracion de la decision
```

Aunque la IA devuelva `allow`, el Business Validator puede convertir la decision
en `block` o `require_approval`.

### 5. Executor

Solo ejecuta decisiones validadas.

Debe recibir algo parecido a:

```txt
decisionId
channel
provider
destination
payload
scheduledFor
idempotencyKey
correlationId
costReservationId
```

No debe recalcular la decision. Si detecta que la decision expiro o que cambio
un dato critico, debe bloquear y pedir una nueva decision.

## Archivos sugeridos

La estructura puede adaptarse a cualquier stack.

```txt
src/
  decisioning/
    models/
      RouterDecision.model
    schemas/
      routerDecision.schema
    services/
      routingDecision.service
      ruleOnlyFallback.service
      businessValidator.service
      inputSnapshot.service
  campaigns/
    services/
      campaignRouting.service
  policy/
    policy.engine
  approvals/
    approval.service
  costs/
    costEstimator.service
    balanceReservation.service
  ai/
    providerSelector.service
    decisionCache.service
    usageLedger.service
    circuitBreaker.service
```

## RouterDecision.model

Responsabilidad:

```txt
guardar decision
guardar inputHash/contextHash
guardar output validado
guardar costo estimado
guardar riesgo
guardar estado
guardar expiracion
guardar auditoria
```

Campos recomendados:

```txt
clientId
sourceModule
sourceType
sourceId
decisionId
mode
state
decision
riskLevel
inputHash
contextHash
schemaVersion
policyVersion
promptVersion
provider
model
tokensInput
tokensOutput
estimatedAiCost
estimatedExternalApiCost
requiresApproval
approvalRequestId
expiresAt
summary
reasonCodes
rulesApplied
batches
perDestinationDecisions
blockedDestinations
requiredActions
costReservation
cacheHit
fallbackUsed
rawOutput
validatedOutput
businessValidationResult
correlationId
causationId
idempotencyKey
createdAt
updatedAt
```

Estados sugeridos:

```txt
requested
rule_checked
cache_hit
ai_requested
ai_decided
schema_validated
business_validated
approval_pending
approved
routable
blocked
expired
failed
cancelled
```

## routingDecision.service

Orquestador principal.

Flujo:

```txt
1. Recibe un snapshot resumido.
2. Calcula inputHash/contextHash.
3. Ejecuta reglas duras.
4. Si las reglas alcanzan, devuelve decision rule-only.
5. Busca cache de decisiones.
6. Si hay cache hit, valida y devuelve.
7. Elige provider/model segun costo, riesgo y plan.
8. Llama IA si aporta valor.
9. Valida JSON estricto.
10. Ejecuta Business Validator.
11. Persiste RouterDecision.
12. Registra tokens y costo.
13. Guarda cache si aplica.
14. Crea ApprovalRequest si corresponde.
15. Devuelve decision final.
```

Pseudocodigo:

```js
async function decide(input) {
  const snapshot = buildSafeSnapshot(input);
  const hashes = hashSnapshot(snapshot);

  const policy = await policyEngine.evaluate(input.scope, snapshot);
  if (!policy.allowed) {
    return persist(ruleOnlyBlocked({ snapshot, policy, hashes }));
  }

  const cached = await decisionCache.lookup(hashes);
  if (cached) {
    return validateAndPersistCacheHit(cached, snapshot);
  }

  const provider = await providerSelector.select({
    feature: input.feature,
    riskLevel: snapshot.riskLevel,
    estimatedTokensInput: snapshot.estimatedTokensInput,
    estimatedTokensOutput: snapshot.estimatedTokensOutput,
  });

  if (!provider) {
    return persist(ruleOnlyFallback(snapshot));
  }

  let raw;
  try {
    raw = await callModel({ provider, snapshot });
  } catch (error) {
    return persist(ruleOnlyFallback(snapshot, { error }));
  }

  const parsed = validateRouterDecisionSchema(raw);
  const finalDecision = await businessValidator.validate(parsed, snapshot);

  await usageLedger.record(raw.usage);
  await decisionCache.storeIfSafe(finalDecision, hashes);

  return persist(finalDecision);
}
```

## campaignRouting.service

Adaptador especifico para campañas o acciones de marketing.

Responsabilidad:

```txt
recibir Campaign
armar snapshot resumido
estimar costos
pedir decision al routingDecision.service
devolver resultado para UI/API
```

Snapshot recomendado:

```txt
campaignId
objective
channels
messageFingerprint
hasLink
mediaCount
destinationsSummary
outlierDestinations
scheduleAt
plan
limits
externalApiCostEstimate
balanceSnapshot
featureFlags
policySnapshot
approvalSnapshot
providerHealthSnapshot
```

Primer endpoint recomendado:

```txt
POST /api/campaigns/:id/routing/simulate
```

Respuesta:

```txt
decision
riskLevel
estimatedAiCost
estimatedExternalApiCost
requiresApproval
summary
reasonCodes
batches
blockedDestinations
requiredActions
expiresAt
```

## routerDecision.schema

Salida minima esperada:

```json
{
  "decisionId": "rdec_123",
  "schemaVersion": "router_decision_output_v1",
  "decision": "allow",
  "riskLevel": "medium",
  "estimatedExternalApiCost": 0,
  "estimatedAiCost": 0.002,
  "requiresApproval": false,
  "expiresAt": "2026-01-01T12:00:00.000Z",
  "summary": "Allowed with conservative batches.",
  "reasonCodes": ["RULES_PASSED"],
  "batches": [],
  "perDestinationDecisions": [],
  "blockedDestinations": [],
  "requiredActions": [],
  "costReservation": {
    "required": false,
    "estimatedAmount": 0
  },
  "rulesApplied": ["policy_passed"],
  "confidence": "medium"
}
```

Enums recomendados:

```txt
decision:
  allow | block | require_approval | split

riskLevel:
  low | medium | high | critical

confidence:
  low | medium | high
```

## ruleOnlyFallback

Fallback conservador cuando la IA falla o no aporta valor.

Reglas:

```txt
si reglas duras bloquean:
  decision = block

si riesgo bajo y reglas duras pasan:
  decision = allow
  usar tandas minimas
  usar delays conservadores

si riesgo medio:
  decision = require_approval

si riesgo alto o critico:
  decision = block
```

Reason codes:

```txt
RULE_ONLY_FALLBACK_USED
AI_PROVIDER_UNAVAILABLE
PROVIDER_CIRCUIT_OPEN
SCHEMA_INVALID
LOW_RISK_RULES_PASSED
MEDIUM_RISK_APPROVAL_REQUIRED
HIGH_RISK_BLOCKED
```

## Reduccion de costo IA

El motor reduce costo porque:

```txt
no llama IA si una regla alcanza
usa cache de decisiones
elige modelo segun costo/riesgo
hace una llamada por campaña, no una por destino
limita el snapshot enviado al modelo
registra tokens por tenant, feature, provider y modelo
mide tokens evitados por reglas/cache/tools
```

Metricas utiles:

```txt
ai_decision_requests_total
ai_decision_cache_hits_total
ai_decision_rule_only_total
ai_decision_tokens_input_total
ai_decision_tokens_output_total
ai_decision_cost_total
ai_decision_fallback_total
ai_decision_schema_failures_total
```

## Reduccion de costo de APIs externas

El motor reduce costo externo porque:

```txt
estima costo antes de ejecutar
bloquea si no hay saldo
reserva saldo antes de ejecutar
evita acciones pagas si no corresponden
muestra costo estimado antes de confirmar
separa acciones gratuitas vs pagas
detecta acciones duplicadas con idempotencia
```

Metricas utiles:

```txt
external_api_cost_estimated_total
external_api_cost_reserved_total
external_api_cost_confirmed_total
external_api_balance_insufficient_total
external_api_reservation_failed_total
decisions_blocked_by_cost_total
```

## Canales experimentales o no oficiales

Si la plataforma soporta canales experimentales, no oficiales o de riesgo
especial, el Decision Engine debe tratarlos como excepcion controlada.

Reglas:

```txt
experimentalChannelEnabled debe ser true
tenant debe tener habilitacion admin/root
tenant debe aceptar terminos especificos
si los terminos vencen o cambian, bloquear
no usar canal experimental como fallback automatico
no usar canal experimental solo para evitar costo de un canal oficial
no permitir modo enforced hasta que exista una decision explicita de producto
```

En canales experimentales el motor solo deberia:

```txt
explicar riesgo
sugerir accion manual
pedir aprobacion
funcionar en advisory o shadow
bloquear si faltan flags o terminos
```

## Modos de rollout

### simulation

```txt
calcula costo/riesgo
no afecta ejecucion
sirve para UI y pruebas
```

### advisory

```txt
muestra recomendacion
puede pedir aprobacion
no ejecuta solo
```

### shadow

```txt
compara decision real vs decision IA
mide desacuerdos
no afecta produccion
```

### enforced

```txt
solo para canales estables
requiere schema validator
requiere business validator
requiere idempotencia
requiere costo reservado si aplica
requiere decision vigente
```

## Eventos recomendados

```txt
routing.requested
routing.decided
routing.blocked
router_ai.requested
router_ai.decided
router_ai.schema_failed
router_ai.business_validation_failed
router_ai.fallback_used
router_ai.cache_hit
approval.requested
external_api.balance.reservation_requested
external_api.balance.reserved
external_api.balance.insufficient
ai.tokens.used
ai.tokens.avoided
```

## Checklist de implementacion

Primer corte:

- Crear `RouterDecision.model`.
- Crear `routerDecision.schema`.
- Crear `ruleOnlyFallback.service`.
- Crear `routingDecision.service`.
- Crear adaptador por dominio, por ejemplo `campaignRouting.service`.
- Integrar Policy Engine.
- Integrar decision cache.
- Integrar provider selector.
- Integrar usage ledger.
- Integrar cost estimator.
- Integrar approvals.
- Exponer endpoint de simulacion.
- Mostrar decision en UI.

Segundo corte:

- Agregar EventOutbox.
- Agregar metricas.
- Agregar dashboard de decisiones.
- Agregar shadow mode.
- Agregar alertas de costo.
- Agregar business validator mas completo.

Tercer corte:

- Activar advisory para tenants beta.
- Activar enforced solo en canales oficiales o estables.
- Mantener canales experimentales en advisory/shadow.

## Conclusiones

Esta arquitectura permite usar IA sin ceder control operacional.

Beneficios:

- menos gasto de tokens;
- menos gasto accidental en APIs externas;
- menos acciones riesgosas;
- decisiones auditables;
- rollback mas simple;
- mejor explicacion para el usuario;
- base solida para aprobaciones y compliance.

Regla final:

```txt
Rules decide what is allowed.
AI optimizes what is allowed.
Validators decide what can be executed.
Executors only run validated decisions.
```
