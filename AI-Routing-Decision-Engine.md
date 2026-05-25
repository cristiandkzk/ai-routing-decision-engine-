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

## El motor es escalable en la toma de decisiones

El motor no es solo para campañas o mensajeria. Es un patron de decision que
aplica a cualquier accion con costo, riesgo o impacto operativo — sin importar
quien la origina.

### Quien puede originar una decision

```txt
Usuario via UI del panel
  -> crea campaña, publica producto, registra gasto

Bot o automatizacion
  -> responde un mensaje entrante, envia un auto-reply programado

Asistente IA interno (agente de panel)
  -> el usuario pide algo en lenguaje natural
  -> el agente propone la accion
  -> el motor valida y decide
  -> el humano aprueba si el riesgo lo exige
  -> el executor ejecuta

Worker o job programado
  -> sync de stock, reconciliacion de ordenes

Webhook de proveedor externo
  -> llega una pregunta de marketplace, un evento de orden, un mensaje inbound
```

Todos estos origenes producen el mismo resultado: un `RoutingSnapshot` con
`action.type` declarado. El motor no sabe ni le importa quien armo el snapshot.

### El patron del asistente IA interno

Un asistente interno (chatbot de panel, agente conversacional) es uno de los
origenes mas comunes en plataformas SaaS. El patron correcto:

```txt
Asistente recibe pedido del usuario en lenguaje natural
  -> Asistente consulta datos necesarios (tools de lectura)
  -> Asistente propone accion (tool propose_*)
  -> tool propose_* arma RoutingSnapshot con action.type correcto
  -> llama routingDecision.service
  -> routingDecision.service ejecuta el flujo completo:
       Policy Engine -> AI Router -> Schema Validator
       -> Business Validator -> ApprovalRequest si corresponde
  -> tool devuelve { status: 'pending_approval' | 'allowed' | 'blocked' }
  -> Asistente comunica el resultado al usuario
```

Lo que el asistente NO hace:

```txt
ejecutar la accion directamente
llamar APIs externas directamente
bypassear el Policy Engine
asumir que su propia evaluacion de riesgo es suficiente
aprobar sus propias propuestas
```

El asistente propone. El motor decide. El humano aprueba si corresponde.
El executor ejecuta.

### Separacion de tools en el asistente

Las tools del asistente deben separarse en dos categorias:

```txt
tools de lectura (read_*):
  -> consultan datos internos directamente
  -> sin Policy Engine, sin Router AI
  -> ejemplos: list_contacts, get_account_info, list_marketplace_questions

tools de propuesta (propose_*):
  -> arman un RoutingSnapshot y llaman routingDecision.service
  -> el resultado es una RouterDecision con su estado
  -> el asistente comunica ese estado, no lo evalua
  -> ejemplos: propose_marketplace_answer, propose_publish_product, propose_finance_expense
```

Esta separacion garantiza que las tools de lectura sean baratas y rapidas,
y que las tools de accion pasen siempre por el motor de decisiones.

### Mapeo de acciones del asistente a action.type

El asistente no necesita saber que scope de policy aplica. Solo declara
`action.type` y el motor enruta al scope correcto.

```txt
responder pregunta de marketplace  -> action.type = 'inbound_reply'
                                      sourceModule = 'marketplace'
                                      sourceType   = 'marketplace_answer_question'

publicar producto en marketplace   -> action.type = 'content_publish'
                                      sourceModule = 'marketplace'
                                      sourceType   = 'marketplace_publish_product'

enviar campaña de marketing        -> action.type = 'campaign_send'
                                      sourceModule = 'campaigns'

responder comentario publico       -> action.type = 'comment_moderate'
                                      sourceModule = 'social'

registrar gasto en finanzas        -> action.type = 'inbound_reply'
                                      sourceModule = 'finance'
                                      sourceType   = 'finance_expense_create'
```

`sourceModule` y `sourceType` son metadata de trazabilidad y auditoria —
identifican el origen exacto dentro del sistema sin afectar el flujo del motor.

### Como se extiende a nuevos dominios

Agregar soporte para un nuevo dominio (marketplace, finanzas, RRHH, logistica)
no requiere cambiar el motor. Solo requiere:

```txt
1. ContextBuilder del dominio
   -> arma el RoutingSnapshot con action.type y sourceModule correctos
   -> incluye el contexto relevante del dominio en el snapshot

2. PolicyScope del dominio (si necesita reglas propias)
   -> si las reglas del action.type existente alcanzan, no hace falta
   -> ejemplo: 'router_ai.inbound_reply' puede cubrir respuestas de marketplace
      si las politicas son las mismas

3. Tool propose_* en el asistente
   -> llama al ContextBuilder y a routingDecision.service
   -> devuelve el estado de la RouterDecision al asistente
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

### Flujo completo con asistente interno

```txt
1. Usuario al asistente: "respondele a pepe123 que si tenemos talle 43"
2. Asistente llama read_marketplace_question({ id: '...' })
3. Asistente llama propose_marketplace_answer({ conversationId, answerText })
4. propose_marketplace_answer:
     a. arma RoutingSnapshot.forInboundReply({
          sourceModule: 'marketplace',
          sourceType:   'marketplace_answer_question',
          ...contexto del marketplace
        })
     b. llama routingDecision.service.decide(snapshot)
     c. Policy Engine evalua 'router_ai.inbound_reply'
     d. Business Validator exige approval en MVP
     e. Se crea ApprovalRequest con status 'pending'
5. Tool devuelve { status: 'pending_approval', approvalId: 'apr_xxx', decisionId: 'rdec_yyy' }
6. Asistente: "La respuesta quedo pendiente de aprobacion (apr_xxx).
              Podés aprobarla desde el panel o por WhatsApp si lo tenes configurado."
7. Usuario aprueba desde el panel
8. Executor recibe la decision approved y ejecuta via Provider Outbound Gateway
```

El asistente nunca sabe si hubo approval o no en el paso 4. Solo recibe el
estado resultante de la RouterDecision y lo comunica. La logica de approval
vive en el Business Validator, no en el asistente.

## Arquitectura multicanal y multi-accion

El Decision Engine debe ser canal-agnostico y accion-agnostica en su core.

El input universal es un `RoutingSnapshot` con un sub-objeto `action` que
identifica que tipo de decision se pide:

```txt
action.type:
  campaign_send      — envio masivo de campaña
  inbound_reply      — respuesta a un mensaje o evento entrante
                       (cubre: DMs, preguntas de marketplace, mensajes de marketplace,
                        respuestas de soporte, propuestas de asistente interno)
  content_publish    — publicar producto o post en canal externo
                       (cubre: publicaciones de marketplace, posts en redes)
  auto_reply         — respuesta automatica del bot
  comment_moderate   — moderar o responder comentario publico
```

`action.sourceModule` y `action.sourceType` son metadata de trazabilidad:

```txt
sourceModule:
  campaigns     — flujo de campañas
  marketplace   — MercadoLibre, eBay, Shopify, etc.
  social        — Instagram, Facebook, etc.
  crm           — respuestas desde el CRM
  finance       — gastos, ingresos
  assistant     — propuestas originadas desde el asistente interno

sourceType:
  ejemplos para marketplace:
    marketplace_answer_question
    marketplace_answer_message
    marketplace_publish_product
    marketplace_update_listing
    marketplace_sync_stock
  ejemplos para finanzas:
    finance_expense_create
    finance_income_record
```

El `action.type` determina:
- el scope de policy a evaluar (cada tipo puede tener reglas duras propias);
- el feature que usa el provider selector (distintos modelos por tipo);
- los titulos de ApprovalRequest;
- que pasos del flujo aplican (ej: reserva de saldo solo en campaign_send).

`sourceModule` y `sourceType` solo afectan trazabilidad y auditoria —
no cambian el flujo del motor.

```txt
adaptador de dominio (campaignRouting.service, instagramEvent.service, etc.)
  -> detecta canal y tipo de accion
  -> instancia el ChannelSnapshot adapter correcto
  -> construye RoutingSnapshot con action.type declarado
  -> llama routingDecision.service

routingDecision.service
  -> siempre recibe el mismo contrato universal (RoutingSnapshot)
  -> no sabe ni le importa si el canal es Meta, Instagram, Baileys, etc.
  -> elige el scope de policy y el feature del selector segun action.type
```

Para agregar un canal nuevo:

```txt
agregar {Canal}ChannelSnapshot.js     <- traduce estado del canal al snapshot universal
agregar {canal}CostEstimator.service  <- estima costo especifico del canal
agregar {canal}Balance.service        <- reserva saldo si el canal lo requiere
agregar politicas especificas del canal o accion si las necesita
```

Para agregar un tipo de accion nuevo:

```txt
agregar scope de policy 'router_ai.{tipo}'  <- reglas duras para ese tipo
agregar feature en providerSelector          <- que modelos pueden responder
agregar factory en RoutingSnapshot           <- RoutingSnapshot.for{Tipo}(p)
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
    RoutingSnapshot                  <- contrato universal con action.type
    adapters/
      MetaChannelSnapshot            <- canal Meta -> snapshot
      InstagramChannelSnapshot       <- canal Instagram -> snapshot
      MercadoLibreChannelSnapshot    <- canal ML -> snapshot
      InstagramEventSnapshot         <- evento inbound -> RoutingSnapshot completo
  campaigns/
    routing/
      CampaignRoutingSnapshot        <- wrapper de RoutingSnapshot para campaign_send
      campaignRouting.service        <- orquestador de campanas
  marketplace/
    context/
      marketplaceContext.builder     <- arma RoutingSnapshot desde eventos de marketplace
  assistant/
    tools/
      propose_marketplace_answer     <- tool del asistente, llama routingDecision.service
      propose_marketplace_publish    <- idem para publicaciones
      propose_finance_expense        <- idem para finanzas
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
      ← scopes por action.type:
          router_ai.routing          (campaign_send)
          router_ai.inbound_reply    (DM, mensaje entrante)
          router_ai.comment_moderate (comentario publico)
          router_ai.auto_reply       (automatizacion)
          router_ai.content_publish  (publicacion en canal externo)
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
  const actionType = snapshot.action?.type || 'campaign_send';

  // El scope de policy varia por action.type.
  // Si el scope no tiene politicas registradas, el engine retorna allowed:true.
  const policyScope = `router_ai.${actionType}`;
  const policy = await policyEngine.evaluate(policyScope, snapshot);
  if (!policy.allowed) {
    return persist(ruleOnlyBlocked({ snapshot, policy, hashes }));
  }

  const cached = await decisionCache.lookup(hashes);
  if (cached) {
    return validateAndPersistCacheHit(cached, snapshot);
  }

  // El feature del selector varia por action.type para permitir
  // distintos modelos segun el tipo de decision.
  const selectorFeature = `decision_engine_${actionType}`;
  const provider = await providerSelector.select({
    feature: selectorFeature,
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

Adaptador especifico para campañas o acciones de marketing.

Responsabilidad:

```txt
detectar canal de la campaña
instanciar el ChannelSnapshot adapter correcto
construir RoutingSnapshot con action.type = 'campaign_send'
estimar costos
llamar routingDecision.service
devolver resultado para UI/API
```

`CampaignRoutingSnapshot` puede existir como wrapper o factory de `RoutingSnapshot`
para este caso especifico. El motor siempre recibe `RoutingSnapshot`.

Snapshot universal recomendado (RoutingSnapshot para campaign_send):

```txt
clientId
sourceId               <- id de la entidad origen (campaignId, eventId, etc.)
correlationId / causationId
schemaVersion
mode
plan
action                 <- { type, sourceModule, sourceType, sourceRef }
campaign               <- state, requiresBalanceReservation, safeHoursRequired (solo en campaign_send)
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

Las campañas muchas veces no tienen `templateCategory` definida al
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
  -> RoutingSnapshot.channel.estimatedCostARS
  -> routingDecision.service lo pasa a la IA y al Business Validator
```

## Seleccion de modelo por plan

El provider selector elige el modelo segun costo, riesgo y plan del tenant.

```txt
plan Base:
  modelo cheap o balanced para decisiones simples y riesgo bajo/medio
  ejemplo: Groq llama-3.3-70b-versatile

plan Pro/Premium:
  modelo best para riesgo complejo y alto volumen
  ejemplo: Groq meta-llama/llama-4-scout-17b-16e-instruct

fallback universal:
  OpenRouter con modelo compatible con structured outputs
  activar cuando el primario falla o el circuito esta abierto
```

Verificar siempre los nombres de modelos contra la API real del proveedor antes
de agregarlos al registry. Los nombres de documentacion de marketing no siempre
coinciden con los IDs reales de la API.

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
hace una llamada por campaña, no una por destino
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
routerAiForInstagramEnabled        <- futuro
routerAiForMercadoLibreEnabled     <- futuro
routerAiForEbayEnabled             <- futuro
routerAiForTelegramEnabled         <- futuro
routerAiForBaileysEnabled          <- siempre advisory/shadow, nunca enforced
routerAiForMarketplaceEnabled      <- flag umbrella para todos los marketplaces
routerAiForAssistantProposalsEnabled  <- habilita propose_* desde asistente interno
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

RoutingSnapshot (con action.type)
  el contrato universal de entrada al motor. define exactamente que datos recibe la IA.
  el campo action.type permite que el motor sea canal-agnostico y accion-agnostica.
  CampaignRoutingSnapshot puede existir como wrapper para campaign_send — pero
  el contrato canonico que recibe routingDecision.service es RoutingSnapshot.

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

6. adaptador de dominio (campaignRouting.service o equivalente)
   construye el RoutingSnapshot con action.type y conecta el dominio con el motor.

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
- Crear `RoutingSnapshot` con contrato universal y `action.type`.
- Crear primer `ChannelSnapshot` adapter para el canal oficial.
- Integrar Policy Engine con scope por `action.type` (minimo: `router_ai.routing` para `campaign_send`).
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

## Bugs reales encontrados durante la implementacion

Estos errores surgieron al correr los tests y la simulacion contra MongoDB.
No al leer el spec — al ejecutarlo.

Se documentan porque los mismos problemas van a aparecer en cualquier
implementacion de este patron.

### 1. isIso aceptaba strings no-ISO

**Symptoma:** el test `routerDecision.schema` pasaba con `expiresAt: 'manana a las 3'`.

**Causa:** `Date.parse()` de V8 acepta strings que no son ISO 8601 y devuelve
un timestamp valido en lugar de `NaN`. El validador confiaba solo en `Date.parse()`.

**Fix:**

```js
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function isIso(v) {
  return isString(v) && ISO_RE.test(v) && !Number.isNaN(Date.parse(v));
}
```

Regla: no usar `Date.parse()` solo para validar formato ISO. Agregar regex primero.

### 2. Policy Engine no bloqueaba en tests de integracion

**Symptoma:** 14 de 22 tests fallaban con `Expected: false, Received: true`.
Las politicas devolvian `allowed: true` para todos los inputs.

**Causa:** el test hacia `require('policy.engine')` directo pero nunca llamaba
`registerAll()`. Sin esa llamada el engine tiene 0 politicas registradas y
devuelve `allowed: true` por defecto.

**Fix:** agregar en el `beforeAll` del test:

```js
const { registerAll } = require('../../src/modules/policy/policies');
beforeAll(() => { registerAll(); });
```

Regla: si el engine usa un registro lazy, el test debe activarlo explicitamente.
No asumir que `require` del engine es suficiente.

### 3. Modelos Groq que no existen

**Symptoma:** `400 json_validate_failed` al llamar al proveedor en la simulacion.

**Causa:** el registry del Provider Selector tenia `openai/gpt-oss-20b` y
`openai/gpt-oss-120b` como modelos de Groq — nombres de una lista de marketing
que no corresponden a modelos reales disponibles en la API.

**Fix:** reemplazar por modelos verificados contra `groq.models.list()`:

```txt
llama-3.3-70b-versatile          <- decision engine, riesgo bajo/medio
meta-llama/llama-4-scout-17b-16e-instruct  <- riesgo alto, mayor capacidad
```

Regla: verificar modelos contra la API real antes de agregarlos al registry.
No copiar nombres de documentacion de marketing.

### 4. La IA genera expiresAt en el pasado

**Symptoma:** `decision: allow` pero `state: blocked` en el Business Validator.
El campo `businessValidationResult.failures` mostraba `DECISION_EXPIRED`.

**Causa:** el modelo genero `expiresAt: "2024-09-17T14:30:00.000Z"` — una fecha
de su training cutoff, no del momento de la llamada. El Business Validator
bloqueaba correctamente porque la fecha ya habia pasado.

**Fix en dos partes:**

Parte 1 — normalizar post-schema si la fecha ya paso:

```js
if (validatedOutput.expiresAt && new Date(validatedOutput.expiresAt) < new Date()) {
  validatedOutput = { ...validatedOutput, expiresAt: new Date(Date.now() + DECISION_TTL_MS) };
}
```

Parte 2 — informarle al modelo la fecha actual en el system prompt:

```js
`La fecha y hora actual es: ${new Date().toISOString()}`
```

Regla: la IA no conoce el tiempo real. Cualquier campo de fecha que dependa
del momento de la llamada debe ser normalizado server-side. No confiar en que
el modelo lo calcule correctamente.

### 5. tenantId como ObjectId en los eventos del outbox

**Symptoma:** warning `tenantId: expected string, got object` en el event
contract validator.

**Causa:** `snapshot.clientId` es un `mongoose.Types.ObjectId`. El event
contract esperaba un string. El contrato fue disenado pensando en strings,
pero el modelo lo persiste como ObjectId.

**Fix:**

```js
tenantId: String(snapshot.clientId),
```

Regla: en la frontera entre Mongoose y sistemas de eventos (outbox, queues,
webhooks), convertir siempre ObjectId a string explicitamente. No asumir que
la serializacion implicita lo hace.

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
- nuevos canales sin tocar el core;
- nuevos dominios (marketplace, finanzas, social) sin tocar el motor;
- asistentes internos que proponen sin ejecutar directamente.

Regla final:

```txt
Las reglas deciden qué está permitido.
La IA optimiza lo que está permitido.
Los validadores deciden qué puede ejecutarse.
Los ejecutores solo ejecutan decisiones validadas.

Quien origina la decision no importa:
  un usuario, un bot, un asistente IA o un worker
  siempre pasan por el mismo motor.
```
