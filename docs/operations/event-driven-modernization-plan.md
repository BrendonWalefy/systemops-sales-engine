# Event-Driven Modernization Plan

Atualizado em: 2026-06-23  
Branch base de trabalho: `docs/event-driven-modernization-plan`

## Objetivo

Modernizar o SystemOps para um modelo mais resiliente, portável e barato de operar, sem aumentar custo agora e sem acoplar a solução ao Vercel.

O resultado esperado e:

- reduzir CPU por request;
- melhorar fluidez do app;
- desacoplar webhook, processamento e envio;
- preparar o codigo para migracao futura para AWS, Fly.io, Render ou outro host com baixo retrabalho;
- criar checkpoints pequenos para outro agente continuar sem perder contexto.

## Contexto atual

Hoje o sistema ainda carrega riscos de uma arquitetura request-driven:

- o webhook Z-API responde rapido, mas ainda processa a jornada dentro da mesma invocation via `after(...)`;
- o `ConversationOrchestrator` mistura decisao de dominio com entrega de saida;
- nao existe fila duravel nem outbox formal;
- a atualizacao de inbox/agenda ainda depende de consultas repetidas e assinatura recalculada;
- o realtime atual em `src/components/realtime-events-provider.tsx` faz polling global em `/api/events/stream`;
- nao existe trilha operacional ponta a ponta para responder rapido onde uma mensagem travou.

Arquivos centrais do estado atual:

- `src/app/api/whatsapp/zapi/route.ts`
- `src/core/pipeline/ConversationOrchestrator.ts`
- `src/infrastructure/adapters/channels/whatsapp/whatsapp-sender.ts`
- `src/components/realtime-events-provider.tsx`
- `src/app/api/events/stream/route.ts`

## Decisao arquitetural

O caminho recomendado e:

1. manter um monorepo;
2. manter Postgres como fonte de verdade;
3. introduzir Inbox Pattern + fila duravel + Outbox Pattern;
4. separar ingestao, processamento e envio por responsabilidade;
5. manter polling inteligente e barato agora;
6. deixar a camada de fila abstraida para troca futura de Postgres -> SQS/Redis/Broker sem refazer regra de negocio.

## Principios

### 1. O sistema decide; a infraestrutura executa

- LLM entende e verbaliza.
- Codigo deterministico decide estado, agenda, retries, handoff e idempotencia.

### 2. Toda entrada importante vira dado persistido antes de virar acao

- webhook nao deve ser o unico lugar onde a mensagem "existe";
- a entrada precisa poder ser auditada e reprocessada.

### 3. Toda saida importante vira intencao persistida antes de ser enviada

- o sistema deve saber exatamente o que pretendia mandar;
- falha de canal nao deve obrigar recomputar a conversa.

### 4. Realtime barato primeiro, realtime sofisticado depois

- agora: versionamento leve + polling adaptativo;
- depois: SSE/WebSocket/servico gerenciado, se e quando o custo fizer sentido.

### 5. Portabilidade e requisito de design

- nomes, contratos e handlers de job devem ser independentes do host;
- mudar de Vercel para outro lugar deve trocar a casca de execucao, nao a regra de negocio.

## Arquitetura alvo em fases

### Fase A - Hardening sem custo extra

Meta: estabilizar sem novo servico pago.

Blocos:

- `inbound_events` para registrar a entrada bruta e deduplicavel;
- `jobs` como fila no Postgres;
- `outbound_messages` como outbox;
- worker logico no mesmo repo;
- polling leve por versao para inbox, agenda e conversa;
- observabilidade minima por rota e job.

Execucao:

- Vercel continua como host web;
- jobs podem ser drenados por cron, rota interna autenticada ou processamento oportunista controlado;
- sem Redis, sem SQS, sem broker externo.

### Fase B - Runtime portavel

Meta: manter a mesma arquitetura, mas com worker dedicado.

Blocos:

- web app stateless;
- worker separado por processo/container;
- mesmo schema;
- mesmo contrato `enqueueJob(...)`;
- mesmo modelo de inbox/outbox.

Hosts viaveis:

- Fly.io
- Render
- Railway
- VPS com Coolify
- AWS ECS/Fargate

### Fase C - Cloud target de escala

Meta: aumentar previsibilidade e escalabilidade quando houver caixa e mais clinicas ativas.

Trocas naturais:

- `jobs` em Postgres -> SQS FIFO ou broker equivalente;
- scheduler simples -> EventBridge Scheduler ou cron dedicado;
- worker no mesmo runtime -> worker dedicado com autoscaling;
- polling leve -> realtime mais forte onde fizer sentido.

## Desenho alvo

Referencia de arquitetura:

- `docs/architecture/target-architecture.md`
- `docs/architecture/aws-target-architecture.md`
- `docs/architecture/diagrams/core-event-driven.png`

Resumo operacional do desenho:

1. webhook recebe e persiste `inbound_events`;
2. webhook cria job `message.process`;
3. worker processa a conversa e grava `outbound_messages`;
4. worker cria job `message.send`;
5. sender entrega no canal e atualiza status;
6. UI consulta apenas versoes leves e recarrega dados completos so quando mudou.

## Contratos que devem nascer agora

Os nomes abaixo devem ser tratados como contrato estavel de arquitetura.

### Job enqueue

```ts
enqueueJob({
  queue: "message.process" | "message.send" | "followup.dispatch",
  dedupeKey?: string,
  runAt?: Date,
  payload: unknown,
})
```

### Job handler

```ts
processJob(job: JobRecord): Promise<JobResult>
```

### Inbox

```ts
recordInboundEvent(input: RecordInboundEventInput): Promise<InboundEvent>
```

### Outbox

```ts
createOutboundMessage(input: CreateOutboundMessageInput): Promise<OutboundMessage>
markOutboundDelivered(input: MarkOutboundDeliveredInput): Promise<void>
```

### UI versioning

```ts
getInboxVersion(clinicId: string): Promise<string>
getAgendaVersion(clinicId: string, from: Date, to: Date): Promise<string>
getConversationVersion(conversationId: string): Promise<string>
```

Esses contratos permitem trocar implementacao sem quebrar a camada de aplicacao.

## Modelo de dados minimo

### 1. `inbound_events`

Finalidade:

- trilha bruta do que entrou;
- deduplicacao;
- replay;
- auditoria.

Campos minimos:

- `id`
- `clinic_id`
- `provider`
- `provider_message_id`
- `conversation_key`
- `payload`
- `normalized_text`
- `media_type`
- `dedupe_key`
- `processing_status`
- `received_at`
- `processed_at`

Indices importantes:

- `unique(provider, provider_message_id)`
- `index(clinic_id, received_at desc)`
- `index(processing_status, received_at asc)`

### 2. `jobs`

Finalidade:

- fila duravel no Postgres;
- retry com backoff;
- controle de concorrencia;
- agendamento.

Campos minimos:

- `id`
- `queue`
- `status`
- `payload`
- `dedupe_key`
- `attempts`
- `max_attempts`
- `run_at`
- `locked_at`
- `locked_by`
- `last_error`
- `created_at`
- `updated_at`

Estados:

- `pending`
- `processing`
- `done`
- `failed`
- `dead`

### 3. `outbound_messages`

Finalidade:

- registrar a intencao de envio;
- evitar recomputar a conversa para retry tecnico;
- auditar texto, audio e midia.

Campos minimos:

- `id`
- `clinic_id`
- `conversation_id`
- `channel`
- `payload`
- `delivery_kind`
- `status`
- `provider_message_id`
- `dedupe_key`
- `attempts`
- `last_error`
- `created_at`
- `sent_at`

## Fatias de implementacao recomendadas

### Slice 1 - Fila e persistencia base

Entrega:

- novas tabelas;
- repositorios;
- enums;
- testes de claim, retry e dedupe.

Nao muda ainda:

- webhook;
- UI;
- envio real.

### Slice 2 - Webhook fino

Entrega:

- `zapi/route.ts` deixa de executar a jornada completa;
- rota grava `inbound_events`;
- rota enfileira `message.process`;
- resposta `200` rapida e idempotente.

### Slice 3 - Conversation worker

Entrega:

- novo worker chama o fluxo de dominio;
- separacao entre processar conversa e enviar resposta;
- `ConversationOrchestrator` deixa de ser acoplado ao request.

### Slice 4 - Outbox e sender

Entrega:

- envio sai do orchestrator e passa a ser outbox + sender;
- retries tecnicos ficam isolados;
- ordem por conversa passa a ser controlada pelo job/claim.

### Slice 5 - UI e realtime barato

Entrega:

- remover polling global caro;
- inbox/agenda/chat passam a usar versao leve;
- polling adaptativo por visibilidade e foco.

### Slice 6 - Observabilidade operacional

Entrega:

- `traceId`, `jobId`, `clinicId`, `conversationId`, `providerMessageId` em logs;
- duracao por job;
- contagem de falha por fila;
- rotas e jobs lentos visiveis.

## Ordem sugerida para a proxima sessao

1. desenhar o schema e gerar migrations de `inbound_events`, `jobs` e `outbound_messages`;
2. criar interfaces e repositorios de fila/inbox/outbox;
3. mover o webhook para persistir e enfileirar;
4. extrair o processamento da conversa para handler de job;
5. extrair o envio para sender;
6. substituir o realtime global por versionamento leve;
7. fechar com observabilidade e budgets.

## Decisoes explicitas para evitar desvio

- Nao introduzir Redis agora.
- Nao contratar mensageria externa agora.
- Nao separar repositrio nem app em varios servicos agora.
- Nao reintroduzir logica pesada em middleware.
- Nao usar WebSocket pago como passo inicial.
- Nao prender a arquitetura a `after(...)` como mecanismo principal de processamento.

## Como isso reduz retrabalho futuro

Essa modernizacao nao e um beco sem saida do Vercel.

Ela prepara o sistema para:

- trocar Postgres queue por SQS ou broker depois;
- mover worker para container dedicado;
- trocar host sem reescrever dominio;
- adicionar autoscaling sem refazer fluxo;
- melhorar realtime depois sem mexer no core transacional.

## Metricas de sucesso

### Operacionais

- webhook p95 significativamente menor que hoje;
- queda de CPU por request e por tela operacional;
- menos refresh completo de inbox/agenda;
- menos timeout e menos retries de provider.

### Produto

- inbox e agenda mais fluidos;
- conversa aberta com menos jank;
- menor risco de duplicacao de resposta;
- maior confiabilidade para varias clinicas.

## Riscos conhecidos

- migracao mal fatiada pode misturar fila, webhook e UI no mesmo commit;
- migracao sem idempotencia pode duplicar mensagem;
- migracao sem testes de claim/retry pode gerar corrida;
- migracao de realtime sem budget claro pode trocar um problema por outro.

## Regras de execucao

- cada slice em branch propria derivada de `develop`;
- cada slice com commit pequeno e rollback claro;
- `npm run verify` antes de push;
- mudancas que afetarem agenda tambem exigem `npm run verify:agenda`.

## Leitura obrigatoria para retomar

Na proxima sessao, o agente deve ler:

1. `README.md`
2. `docs/architecture/current.md`
3. `docs/operations/change-control.md`
4. este documento
5. `docs/operations/event-driven-modernization-checkpoints.md`

