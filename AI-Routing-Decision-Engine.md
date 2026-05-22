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
- pueda operar en modo simulacion antes de afectar produccion;
- soporte multiples canales sin cambiar el core.

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

## Arquitectura multicanal

El Decision Engine debe ser canal-agnostico en su core.

```txt
campaignRouting.service
  -> detecta canal de la campana
  -> instancia ChannelSnapshot adapter correcto
  -> construye snapshot universal (CampaignRoutingSnapshot)
  -> llama routingDecision.service

routingDecision.service
  -> siempre recibe el mismo contrato universal
  -> no sabe ni le importa si el canal es Meta, Instagram, Telegram, etc.
```

Para agregar un canal nuevo:

```txt
agregar {Canal}ChannelSnapshot.js     <- traduce estado del canal al snapshot universal
agregar {canal}CostEstimator.service  <- estima costo especifico del canal
agregar {canal}Balance.service        <- reserva saldo si el canal lo requiere
agregar politicas especificas del canal si las necesita
```

No cambiar:

```txt
routingDecision.service
RouterDecision.model
routerDecision.schema
ruleOnlyFallback.service
Policy Engine
AI Decision Cache
Provider Selector
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

Las politicas deben agruparse por scope. Para routing se recomienda el scope
`router_ai.routing` con este orden de evaluacion:

```txt
optOut
campaignChannel
channelConnected
channelBalance
planLimits
riskGates
{canal}Experimental (si el canal tiene restricciones adicionales)
```

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
  registrar evento schema_failed
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
  routing/
    campaignRouting.service          <- orquestador, canal-agnostico
    CampaignRoutingSnapshot          <- builder del snapshot universal
    adapters/
      MetaChannelSnapshot            <- canal Meta
      InstagramChannelSnapshot       <- futuro
      MercadoLibreChannelSnapshot    <- futuro
      TelegramChannelSnapshot        <- futuro
  policy/
    policy.engine
    policies/
      routerAi/
        optOut.policy
        campaignChannel.policy
        channelConnected.policy
        channelBalance.policy
        planLimits.policy
        riskGates.policy
        experimentalChannel.policy   <- para canales experimentales
  approvals/
    approval.service
  costs/
    {canal}CostEstimator.service
    {canal}Balance.service
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
guardar costo estimado (IA y canal externo)
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
channel
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
estimatedAiCostUSD
estimatedCostARS
requiresApproval
approvalRequestId
expiresAt
summary
confidence
reasonCodes
rulesApplied
batches
perDestinationDecisions
blockedDestinations
requiredActions
balanceReservation
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

`estimatedCostARS` es el campo universal de costo externo. Cada canal calcula
el suyo y lo normaliza a esta unidad antes de guardarlo.

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

Transiciones clave:

```txt
requested -> rule_checked
rule_checked -> ai_requested si la IA aporta valor
rule_checked -> business_validated si reglas alcanzan
ai_requested -> ai_decided
ai_decided -> schema_validated
schema_validated -> business_validated
business_validated -> approval_pending si requiere aprobacion
business_validated -> routable si puede ejecutarse
business_validated -> blocked si falla una regla dura
approval_pending -> approved
approved -> routable
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
async function decide(snapshot, opts) {
  const hashes = hashSnapshot(snapshot);

  const policy = await policyEngine.evaluate('router_ai.routing', snapshot);
  if (!policy.allowed) {
    return persist(ruleOnlyBlocked({ snapshot, policy, hashes }));
  }

  const cached = await decisionCache.lookup(hashes);
  if (cached) {
    return validateAndPersistCacheHit(cached, snapshot);
  }

  const provider = await providerSelector.select({
    feature: 'router_ai',
    riskLevel: snapshot.risk.riskLevel,
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
  if (!parsed.valid) {
    return persist(ruleOnlyFallback(snapshot, { reason: 'SCHEMA_INVALID' }));
  }

  const finalDecision = await businessValidator.validate(parsed.normalized, snapshot);

  await usageLedger.record(raw.usage);
  await decisionCache.storeIfSafe(finalDecision, hashes);

  return persist(finalDecision);
}
```

El servicio no sabe que canal es. Recibe snapshot, produce decision.

No debe:

```txt
ejecutar envios
reservar saldo directamente
ignorar policies
aceptar output IA sin schema validator
mandar message.text al modelo (prevencion de prompt injection)
```

## campaignRouting.service

Adaptador especifico para campanas o acciones de marketing.

Responsabilidad:

```txt
detectar canal de la campana
instanciar el ChannelSnapshot adapter correcto
construir CampaignRoutingSnapshot universal
estimar costos
llamar routingDecision.service
devolver resultado para UI/API
```

Snapshot universal recomendado (CampaignRoutingSnapshot):

```txt
campaignId
correlationId / causationId
schemaVersion
mode
plan
campaignType
campaign               <- state, requiresBalanceReservation, safeHoursRequired
message                <- fingerprint, hasLink, mediaCount (sin text crudo)
destinations[]         <- resumen: id, type, riskScore, optOut, pauseState
channel                <- objeto universal (ver abajo)
limits                 <- normalizados del plan
risk                   <- healthScore, warmupStage, linkReputation, safeHours
featureFlags
operationalState       <- pauses, circuitBreakers, locks
```

Objeto `channel` universal:

```txt
channelType            <- "meta" | "instagram" | "mercadolibre" | "telegram" | "baileys"
channelStatus          <- "connected" | "disconnected" | "degraded"
channelVerified        <- boolean
estimatedCostARS       <- normalizado (cada canal calcula el suyo)
costCurrency           <- "ARS" | "USD"
supportsGroups         <- boolean
supportsBroadcast      <- boolean
supportsTemplates      <- boolean
supportsMedia          <- boolean
rateLimitRemaining     <- number, normalizado
qualityScore           <- 0-100, normalizado
channelMeta            <- datos especificos del canal (no campos de negocio generales)
```

Cada `ChannelSnapshot` adapter traduce el estado del canal a este contrato.
El `routingDecision.service` siempre recibe el mismo objeto.

Primer endpoint recomendado:

```txt
POST /api/campaigns/:id/routing/simulate
POST /api/campaigns/:id/routing/advisory
GET  /api/campaigns/:id/routing/decision/:decisionId
```

Respuesta para UI:

```txt
decisionId
state
mode
channel
decision
riskLevel
estimatedCostARS
estimatedAiCostUSD
requiresApproval
summary
confidence
reasonCodes
rulesApplied
batches
perDestinationDecisions
blockedDestinations
requiredActions
balanceReservation
cacheHit
fallbackUsed
expiresAt
createdAt
```

## routerDecision.schema

Salida minima esperada del modelo:

```json
{
  "decisionId": "rdec_123",
  "schemaVersion": "router_ai_output_v1",
  "decision": "allow",
  "riskLevel": "medium",
  "estimatedCostARS": 0,
  "estimatedAiCostUSD": 0.002,
  "requiresApproval": false,
  "expiresAt": "2026-01-01T12:00:00.000Z",
  "summary": "Allowed with conservative batches.",
  "confidence": "medium",
  "reasonCodes": ["RULES_PASSED"],
  "batches": [],
  "perDestinationDecisions": [],
  "blockedDestinations": [],
  "requiredActions": [],
  "balanceReservation": {
    "required": false,
    "estimatedAmountARS": 0
  },
  "rulesApplied": ["policy_passed"]
}
```

`estimatedCostARS` reemplaza cualquier campo de costo especifico por canal
(`estimatedMetaCost`, `estimatedApiCost`, etc.). El adapter de cada canal
calcula el costo en su moneda y lo normaliza antes de pasarlo al schema.

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

Implementar como politica dedicada:

```txt
{canal}Experimental.policy
  -> verifica flags de habilitacion
  -> verifica terminos aceptados y vigencia
  -> bloquea modo enforced
  -> bloquea uso como fallback de canal oficial
```

## Estimacion de costo del canal

El campo `estimatedCostARS` del snapshot universal no es un dato que la IA
calcula — es un dato que la plataforma calcula antes de llamar a la IA.
La IA lo recibe como contexto para tomar mejores decisiones.

### Donde se calcula

En el adaptador de dominio (`campaignRouting.service`), dentro de
`_buildChannelSnapshot`, antes de construir el snapshot universal.
El `routingDecision.service` recibe el costo ya calculado — no lo
vuelve a calcular.

### Como se calcula

Cada canal tiene su propio estimador:

```txt
{canal}CostEstimator.service
  -> consulta rate card vigente del canal
  -> aplica markup del proveedor si aplica
  -> filtra destinatarios con opt-out o pausados (no cuentan)
  -> calcula costo total en la moneda del canal (USD, EUR, etc.)
  -> convierte a moneda local usando tipo de cambio cacheado
  -> retorna estimatedCostARS (o el equivalente local)
```

### Logica de fallback del estimador

El estimador nunca debe romper el flujo de routing.

```txt
si rate card no existe para el pais del destinatario:
  usar tarifa GLOBAL como proxy conservador

si falla la conversion a moneda local:
  usar tasa de fallback del .env

si el estimador falla completamente:
  loguear warning
  retornar 0
  el costo real se confirma al reservar saldo antes de ejecutar
```

Si el estimador retorna `0`, la policy de balance no bloquea — la IA
recibe costo `0` y el costo real queda diferido a la reserva de saldo.

### Si el caller ya trae el costo calculado

Si el request ya incluye `estimatedCostARS > 0` (calculado por la UI
antes de llamar al endpoint), el adaptador lo usa directo sin consultar
la rate card:

```txt
if (overrideARS != null && overrideARS > 0) return overrideARS;
```

### Por que usar una tarifa global como proxy

Las campanas muchas veces no tienen `templateCategory` definida al
momento de simular. La tarifa GLOBAL+marketing es conservadora: tiende
a sobreestimar, lo que es preferible a subestimar y no bloquear envios
sin saldo suficiente.

### Tipo de cambio

Si el canal cobra en USD y la plataforma trabaja en moneda local:

```txt
cachear el tipo de cambio (recomendado: 30 minutos)
si la fuente externa falla, usar fallback del .env
nunca bloquear el flujo de routing por una falla del tipo de cambio
```

### Resumen del flujo

```txt
targets (filtrados: sin opt-out ni pausados)
  -> rate card del canal (por pais o GLOBAL)
  -> unitCost = precio * (1 + markupPct / 100)
  -> totalUSD = unitCost * recipientCount
  -> arsRate = getExchangeRate() con fallback a .env
  -> estimatedCostARS = ceil(totalUSD * arsRate)
  -> ChannelSnapshot.build({ estimatedCostARS, ... })
  -> CampaignRoutingSnapshot.channel.estimatedCostARS
  -> routingDecision.service lo pasa a la IA y al Business Validator
```

## Seleccion de modelo por plan

El provider selector elige el modelo segun costo, riesgo y plan del tenant.

```txt
plan Base:
  modelo cheap o balanced para decisiones simples y riesgo bajo/medio
  ejemplo: Groq openai/gpt-oss-20b

plan Pro/Premium:
  modelo best para riesgo complejo y alto volumen
  ejemplo: Groq openai/gpt-oss-120b

fallback universal:
  OpenRouter con modelo compatible con structured outputs
  activar cuando el primario falla o el circuito esta abierto
```

Reglas para el provider selector:

```txt
no llamar IA si una regla alcanza
no usar modelos sin structured outputs para decisiones criticas
registrar el modelo real usado en RouterDecision
elegir el modelo suficiente mas barato, no siempre el mejor
```

## Reduccion de costo IA

El motor reduce costo porque:

```txt
no llama IA si una regla alcanza
usa cache de decisiones
elige modelo segun costo/riesgo
hace una llamada por campana, no una por destino
limita el snapshot enviado al modelo (sin message.text, sin secretos)
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
external_api_cost_estimated_total{channel}
external_api_cost_reserved_total{channel}
external_api_cost_confirmed_total{channel}
external_api_balance_insufficient_total{channel}
external_api_reservation_failed_total{channel}
decisions_blocked_by_cost_total{channel}
```

El label `{channel}` permite comparar el impacto por canal cuando se agreguen
nuevos canales.

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
solo para canales estables y oficiales
requiere schema validator
requiere business validator
requiere idempotencia
requiere costo reservado si aplica
requiere decision vigente
```

Regla:

```txt
Los canales experimentales no deben arrancar en enforced.
Para canales experimentales: advisory/shadow o bloquear salvo habilitacion explicita.
```

## Eventos recomendados

```txt
router_ai.decided
router_ai.blocked
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

Reglas de eventos:

```txt
cada decision debe tener decisionId unico
cada evento debe llevar clientId, correlationId, causationId
cada handler debe ser idempotente
si el schema falla, emitir router_ai.schema_failed
si usa fallback, emitir router_ai.fallback_used
si requiere aprobacion, emitir approval.requested
```

Los eventos deben pasar por EventOutbox y guardarse atomicamente con
RouterDecision para garantizar consistencia en reintentos.

## Feature flags recomendadas

```txt
routerAiEnabled
routerAiForCampaignsEnabled
routerAiForMetaEnabled
routerAiForInstagramEnabled      <- futuro
routerAiForMercadoLibreEnabled   <- futuro
routerAiForTelegramEnabled       <- futuro
routerAiForBaileysEnabled        <- siempre advisory/shadow, nunca enforced
tenantRouterAiEnabled
forceRuleOnlyForTenant
```

Comportamiento por flag:

```txt
routerAiEnabled=false:
  usar Rule Engine sin IA

routerAiMode=shadow:
  ejecutar decision real por reglas
  guardar decision IA solo para comparacion

routerAiMode=advisory:
  mostrar recomendacion IA
  requerir confirmacion humana

routerAiMode=enforced:
  permitir que la decision IA validada afecte routing
  solo en canales estables
```

## Observabilidad

Metricas:

```txt
ai_router_requests_total{channel}
ai_router_cache_hits_total{channel}
ai_router_success_total{channel}
ai_router_schema_failures_total
ai_router_business_validation_failures_total{channel}
ai_router_fallback_total
ai_router_latency_ms
ai_router_cost_usd
ai_router_tokens_input_total
ai_router_tokens_output_total
campaigns_blocked_by_ai{channel}
campaigns_required_approval{channel}
router_ai_shadow_disagreements_total
router_ai_decision_expired_total
router_ai_rule_only_fallback_total
router_ai_dlq_count
router_ai_provider_circuit_open_total
router_ai_balance_reservation_failures_total{channel}
router_ai_business_validator_overrides_total
```

El label `{channel}` es la forma de comparar canales sin cambiar el core del motor.

Alertas recomendadas:

```txt
schema failure > 2%
fallback > 5%
latency p95 alta
costo IA mensual alto
cache hit rate bajo
shadow mode muestra alto desacuerdo
decisiones expiran antes de ejecutar
fallan reservas de saldo
```

## Estructuras necesarias para implementar

Antes de escribir la primera linea del motor, estas estructuras deben existir
o construirse. El motor las consume — no las reemplaza.

### Estructuras de datos (modelos / schemas)

```txt
RouterDecision
  la decision en si misma, con su state machine.
  sin esto no hay auditoria ni idempotencia.

EventOutbox
  cola de eventos para publicar de forma atomica con RouterDecision.
  sin esto los eventos pueden perderse en un crash entre la decision y
  la publicacion.

ApprovalRequest
  solicitud de aprobacion humana generada cuando requiresApproval = true.
  sin esto el flujo de advisory no tiene donde persistir la aprobacion.

CampaignRoutingSnapshot (o equivalente por dominio)
  el contrato de entrada al motor. define exactamente que datos recibe la IA.
  sin un contrato fijo, el motor no es canal-agnostico.

RouterDecision.schema (JSON Schema del output de IA)
  define exactamente que debe devolver el modelo.
  sin esto no hay forma de validar ni rechazar output invalido.
```

### Servicios de infraestructura

```txt
Policy Engine
  evalua reglas duras antes de llamar a la IA.
  debe soportar scopes (ej: 'router_ai.routing') para agrupar politicas.
  sin esto la IA puede recibir requests que las reglas deberian bloquear.

AI Decision Cache
  evita llamar a la IA cuando el input y el contexto no cambiaron.
  key: hash(inputSnapshot) + hash(contextSnapshot).
  sin esto cada request gasta tokens aunque la decision sea identica.

Provider Selector
  elige (provider, model) segun feature, riskLevel y plan del tenant.
  debe soportar circuit breaker por provider.
  sin esto se usa siempre el mismo modelo sin importar costo o riesgo.

AI Circuit Breaker
  abre el circuito cuando un provider falla repetidamente.
  sin esto una caida de Groq puede generar miles de timeouts en cascada.

AI Usage Ledger
  registra tokens reales (input + output) por tenant, feature y modelo.
  sin esto no hay forma de medir costo real ni detectar abuso.

{canal}CostEstimator
  estima costo del canal antes de construir el snapshot.
  un estimador por canal. retorna 0 si falla — nunca rompe el flujo.
  sin esto la IA recibe estimatedCostARS = 0 siempre.

{canal}BalanceService
  reserva saldo antes de ejecutar en modo enforced.
  sin esto se pueden ejecutar envios sin saldo disponible.
```

### Servicios de negocio

```txt
ApprovalService
  crea y gestiona ApprovalRequest cuando requiresApproval = true.
  el motor la llama — no la implementa.

Rate Card / Pricing Store
  almacena precios por canal, pais y categoria.
  el estimador la consulta. debe soportar vigencia temporal (effectiveFrom/To).

Exchange Rate Service
  convierte costo del canal (USD, EUR, etc.) a moneda local.
  debe tener cache (recomendado: 30 minutos) y fallback de .env.
  sin esto la conversion falla si la API externa no responde.
```

### Lo que el motor NO necesita que exista antes

```txt
el executor de envios
  el motor solo produce decisiones. el executor puede implementarse despues.

el dashboard de decisiones
  util pero no bloqueante. las decisiones ya quedan en RouterDecision.

el shadow mode completo
  se puede activar despues de validar simulation y advisory.

multiples ChannelSnapshot adapters
  solo se necesita el del canal oficial para el primer corte.
```

### Orden de construccion recomendado

```txt
1. RouterDecision.model + routerDecision.schema
   sin persistencia no hay nada que auditar.

2. ruleOnlyFallback.service
   el motor necesita poder operar sin IA desde el primer dia.

3. Policy Engine con las politicas minimas del canal
   las reglas duras deben existir antes que la IA.

4. routingDecision.service (orquestador)
   integra todo lo anterior.

5. ChannelSnapshot adapter del canal oficial
   traduce el estado del canal al contrato universal.

6. campaignRouting.service (o equivalente por dominio)
   conecta el dominio con el motor.

7. Endpoint de simulacion
   primer punto de entrada para validar el flujo completo.

8. AI Decision Cache + Provider Selector
   optimizacion de costo — pueden agregarse en el segundo corte
   si el primer corte ya funciona correctamente.
```

## Checklist de implementacion

Primer corte:

- Crear `RouterDecision.model`.
- Crear `routerDecision.schema`.
- Crear `ruleOnlyFallback.service`.
- Crear `routingDecision.service`.
- Crear adaptador por dominio, por ejemplo `campaignRouting.service`.
- Crear `CampaignRoutingSnapshot` con contrato universal.
- Crear primer `ChannelSnapshot` adapter para el canal oficial.
- Integrar Policy Engine con scope `router_ai.routing`.
- Integrar decision cache.
- Integrar provider selector con seleccion por plan.
- Integrar usage ledger.
- Integrar cost estimator del canal.
- Integrar approvals.
- Exponer endpoint de simulacion.
- Mostrar decision en UI.

Segundo corte:

- Agregar EventOutbox atomico con RouterDecision.
- Agregar metricas con label `{channel}`.
- Agregar dashboard de decisiones.
- Agregar shadow mode.
- Agregar alertas de costo.
- Agregar business validator mas completo.

Tercer corte:

- Activar advisory para tenants beta.
- Activar enforced solo en canales oficiales o estables.
- Mantener canales experimentales en advisory/shadow.
- Agregar nuevos `ChannelSnapshot` adapters para canales adicionales.

## Tests

Sin tests no se puede confiar en que el motor se comporta correctamente bajo
condiciones reales. El motor tiene multiples capas que interactuan — un error
en cualquiera puede resultar en un envio no autorizado o un bloqueo incorrecto.

### Que testear y por que

No testear la IA. Testear que el motor la usa bien y que sobrevive cuando falla.

```txt
Policy Engine:
  verifica que las reglas duras bloquean antes de llegar a la IA.
  si esto falla, la IA puede recibir requests que no deberia.

Schema Validator:
  verifica que output invalido activa el fallback, no un error no manejado.
  si esto falla, un modelo alucinando puede romper el flujo completo.

Business Validator:
  verifica que un "allow" de la IA puede convertirse en "block".
  si esto falla, la IA tiene la ultima palabra — que es exactamente lo que
  esta arquitectura promete evitar.

ruleOnlyFallback:
  verifica que cuando la IA no esta disponible, el sistema no se rompe.
  si esto falla, una caida del proveedor de IA rompe toda la plataforma.

Cost Estimator:
  verifica que un fallo del estimador no bloquea el flujo.
  verifica que retorna 0 (no lanza excepcion) cuando la rate card no existe.

Cache:
  verifica que dos requests identicas no llaman a la IA dos veces.
  verifica que un cambio en el contexto (saldo, health score) invalida la cache.
```

### Casos minimos obligatorios

Estos casos deben pasar antes de activar cualquier modo que no sea simulation:

```txt
Plan insuficiente
  input:  plan = 'Free', modo = 'advisory'
  expect: decision = block, reasonCode incluye PLAN_NOT_ALLOWED

Canal desconectado
  input:  channelStatus = 'disconnected'
  expect: decision = block, reasonCode incluye CHANNEL_DISCONNECTED

Saldo insuficiente
  input:  estimatedCostARS = 5000, availableBalanceARS = 100
  expect: decision = block, reasonCode incluye CHANNEL_BALANCE_INSUFFICIENT

Opt-out total
  input:  todos los destinations con optOut = true
  expect: decision = block, reasonCode incluye OPT_OUT

Opt-out parcial
  input:  algunos destinations con optOut = true
  expect: decision != block global, blockedDestinations incluye los opt-out

Health score critico
  input:  healthScore = 20
  expect: decision = block o require_approval segun politica

IA no disponible
  input:  provider no responde (mock de timeout)
  expect: decision via ruleOnlyFallback, fallbackUsed = true, no exception

Schema invalido en primer intento, valido en segundo
  input:  mock que devuelve JSON invalido la primera vez, valido la segunda
  expect: decision valida, schemaAttempts = 2, tokens acumulados de ambas llamadas

Schema invalido en ambos intentos
  input:  mock que siempre devuelve JSON invalido
  expect: decision via ruleOnlyFallback, evento schema_failed emitido

IA devuelve allow, Business Validator lo convierte en block
  input:  mock de IA devuelve allow, pero canal se desconecta entre llamada y validacion
  expect: decision = block, businessValidationResult.passed = false

Cache hit
  input:  dos requests con mismo inputHash + contextHash
  expect: segunda request no llama a la IA, cacheHit = true

Cache invalidada por cambio de contexto
  input:  primera request con healthScore = 80, segunda con healthScore = 20
  expect: segunda request llama a la IA (contextHash diferente)

Canal experimental en modo enforced
  input:  channelType = 'experimental', mode = 'enforced'
  expect: decision = block, sin importar lo que diga la IA

Reserva de saldo falla en modo enforced
  input:  channelBalanceService.requestReservation lanza error
  expect: decision final = block, reasonCode incluye CHANNEL_BALANCE_INSUFFICIENT

Decision expirada
  input:  RouterDecision con expiresAt en el pasado
  expect: executor rechaza la decision, no ejecuta
```

### Estructura sugerida

```txt
tests/
  unit/
    routerDecision.schema.test      <- valida y rechaza outputs de IA
    ruleOnlyFallback.test           <- cubre los 4 casos de riesgo
    businessValidator.test          <- "allow" de IA convertido en "block"
    costEstimator.test              <- fallo de rate card, conversion, override
  integration/
    policyEngine.routing.test       <- cada politica bloquea lo que debe
    routingDecision.service.test    <- flujo completo con mocks de IA y DB
    cache.invalidation.test         <- hit, miss, invalidacion por contexto
  e2e/
    simulate.endpoint.test          <- POST /routing/simulate responde correctamente
    advisory.endpoint.test          <- POST /routing/advisory genera ApprovalRequest
```

### Como mockear la IA en tests

No llamar al proveedor real en tests. Mockear `_callAI` para controlar exactamente
que devuelve:

```js
// mock que devuelve output valido
jest.spyOn(routingDecision, '_callAI').mockResolvedValue({
  content: JSON.stringify(validOutput),
  tokensInput: 120,
  tokensOutput: 80,
});

// mock que simula timeout
jest.spyOn(routingDecision, '_callAI').mockRejectedValue(
  new Error('Request timeout')
);

// mock que devuelve schema invalido
jest.spyOn(routingDecision, '_callAI').mockResolvedValue({
  content: '{"decision": "maybe"}',
  tokensInput: 50,
  tokensOutput: 10,
});
```

### Que NO testear

```txt
que el modelo de IA toma la decision correcta
  -> eso es evaluacion del modelo, no test de integracion

que la rate card tiene los precios correctos
  -> eso es un test de datos, no de logica

que el proveedor de IA esta disponible
  -> eso es monitoreo, no test
```

### Regla de oro

```txt
si un test requiere que la IA responda correctamente para pasar,
no es un test del motor — es un test del modelo.
el motor debe funcionar correctamente sin importar lo que diga la IA.
```

## Conclusiones

Esta arquitectura permite usar IA sin ceder control operacional.

Beneficios:

- menos gasto de tokens;
- menos gasto accidental en APIs externas;
- menos acciones riesgosas;
- decisiones auditables;
- rollback mas simple;
- mejor explicacion para el usuario;
- base solida para aprobaciones y compliance;
- nuevos canales sin tocar el core.

Regla final:

```txt
Rules decide what is allowed.
AI optimizes what is allowed.
Validators decide what can be executed.
Executors only run validated decisions.
```
