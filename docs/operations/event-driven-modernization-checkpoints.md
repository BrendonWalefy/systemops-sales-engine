# Event-Driven Modernization Checkpoints

Atualizado em: 2026-06-23  
Branch de planejamento: `docs/event-driven-modernization-plan`

## Como usar este documento

Este arquivo existe para continuidade entre sessoes e entre agentes.

Se uma sessao acabar por limite de tokens, retome daqui:

1. confirme a branch atual;
2. leia `docs/operations/event-driven-modernization-plan.md`;
3. pegue o primeiro checkpoint ainda nao concluido;
4. implemente apenas aquela fatia;
5. rode as validacoes exigidas;
6. atualize este arquivo ao terminar.

## Estado atual

- [x] Plano mestre da modernizacao criado
- [x] Checkpoint 1 - Schema da fila, inbox e outbox
- [x] Checkpoint 2 - Abstracoes e repositorios
- [x] Checkpoint 3 - Webhook fino
- [x] Checkpoint 4 - Conversation worker
- [ ] Checkpoint 5 - Sender worker
- [ ] Checkpoint 6 - Realtime barato por versao
- [ ] Checkpoint 7 - Observabilidade operacional

## Checkpoint 1 - Schema da fila, inbox e outbox

Objetivo:

- criar base transacional da nova arquitetura sem alterar ainda o fluxo principal.

Escopo:

- adicionar enums e tabelas em `src/infrastructure/db/schema.ts`;
- gerar migration nova com `npm run db:generate`;
- criar testes de schema/repository se necessario;
- documentar indices e regras de dedupe.

Arquivos provaveis:

- `src/infrastructure/db/schema.ts`
- `drizzle/*.sql`
- `src/__tests__/*`

Concluido quando:

- tabelas `inbound_events`, `jobs` e `outbound_messages` existirem;
- migration estiver gerada;
- estados e indices estiverem claros.

Validacao minima:

```bash
npm run verify
```

Commit sugerido:

```text
feat(queue): add inbound events jobs and outbound outbox schema
```

## Checkpoint 2 - Abstracoes e repositorios

Objetivo:

- impedir acoplamento da camada de aplicacao ao mecanismo atual de execucao.

Escopo:

- criar interfaces de inbox/outbox/queue;
- implementar repositorios Drizzle;
- criar funcao de claim com lock seguro;
- criar estrategia de retry/backoff.

Arquivos provaveis:

- `src/application/ports/*`
- `src/infrastructure/repositories/*`
- `src/application/services/*`
- `src/__tests__/*`

Concluido quando:

- existir `enqueueJob(...)`;
- existir claim de job sem corrida obvia;
- existir teste de dedupe e retry.

Validacao minima:

```bash
npm run verify
```

Commit sugerido:

```text
feat(queue): add postgres queue repositories and claim flow
```

## Checkpoint 3 - Webhook fino

Objetivo:

- parar de usar a request do webhook como lugar onde a jornada inteira acontece.

Escopo:

- adaptar `src/app/api/whatsapp/zapi/route.ts`;
- persistir `inbound_events`;
- criar job `message.process`;
- responder rapido;
- manter idempotencia por `provider_message_id`.

Concluido quando:

- webhook nao chamar mais a jornada completa diretamente;
- `after(...)` nao for mais a estrategia principal de processamento;
- entrada ficar reprocessavel.

Ordem de deploy:

- nao liberar este checkpoint sozinho em producao: ele apenas persiste e cria `message.process`;
- disponibilizar o worker do Checkpoint 4 na mesma release, ou antes de apontar trafego para este webhook;
- rollback seguro: reverter este commit interrompe novas filas; eventos ja persistidos permanecem auditaveis para replay.

Validacao minima:

```bash
npm run verify
```

Testes alvo:

- duplicata por `messageId`
- mensagem `fromMe`
- mensagem sem texto
- clinica nao resolvida

Commit sugerido:

```text
refactor(webhook): persist inbound events and enqueue processing
```

## Checkpoint 4 - Conversation worker

Objetivo:

- mover a logica da jornada para um handler de job.

Escopo:

- criar handler `message.process`;
- extrair do `ConversationOrchestrator` o que ainda estiver acoplado ao request;
- garantir que o worker persiste resultado antes do envio tecnico;
- manter a regra "o sistema decide".

Arquivos provaveis:

- `src/core/pipeline/ConversationOrchestrator.ts`
- `src/application/jobs/*`
- `src/app/api/internal/*` ou `scripts/*`
- `src/__tests__/*`

Concluido quando:

- a conversa puder ser processada fora da request;
- job handler tiver entrada e saida claras;
- retries nao duplicarem a resposta de negocio.

Operacao temporaria:

- `/api/cron/message-worker` drena ate tres jobs `message.process` por minuto, protegido por `CRON_SECRET`;
- a resposta da conversa e persistida antes do envio pelo orquestrador atual;
- a outbox e o sender dedicado permanecem no Checkpoint 5.

Validacao minima:

```bash
npm run verify
```

Commit sugerido:

```text
refactor(worker): move conversation processing into job handler
```

## Checkpoint 5 - Sender worker

Objetivo:

- separar computacao da resposta de entrega ao canal.

Escopo:

- gravar `outbound_messages` antes do envio;
- criar job `message.send`;
- mover integracao com WhatsApp para sender;
- atualizar estados de entrega e retry tecnico.

Concluido quando:

- orchestrator nao enviar direto ao canal;
- falha de envio nao exigir recomputar a conversa;
- ordem por conversa estiver sob controle.

Validacao minima:

```bash
npm run verify
```

Commit sugerido:

```text
refactor(sender): deliver whatsapp messages from durable outbox
```

## Checkpoint 6 - Realtime barato por versao

Objetivo:

- reduzir custo de CPU no app operacional sem perder fluidez.

Escopo:

- remover polling global caro em `RealtimeEventsProvider`;
- trocar `/api/events/stream` por endpoints leves por recurso;
- usar `getInboxVersion`, `getAgendaVersion` e `getConversationVersion`;
- aplicar polling adaptativo por visibilidade e foco.

Arquivos provaveis:

- `src/components/realtime-events-provider.tsx`
- `src/app/api/events/stream/route.ts`
- `src/app/(clinic)/app/inbox/*`
- `src/app/(clinic)/app/agenda/*`
- `src/app/api/conversations/*`

Concluido quando:

- inbox, agenda e chat deixarem de forcar refresh completo sem mudanca real;
- a aba oculta parar de gerar custo desnecessario;
- CPU e jank cairem nas telas principais.

Validacao minima:

```bash
npm run verify
```

Commit sugerido:

```text
fix(realtime): replace global polling with lightweight version checks
```

## Checkpoint 7 - Observabilidade operacional

Objetivo:

- saber exatamente onde uma mensagem travou e quanto cada etapa custa.

Escopo:

- padronizar logs com `traceId`, `jobId`, `clinicId`, `conversationId`;
- medir duracao por job e por rota;
- alertar fila parada, job morto e erro repetido;
- documentar budgets.

Concluido quando:

- houver trilha minima ponta a ponta;
- for possivel responder rapido se o problema esta no webhook, worker ou sender.

Validacao minima:

```bash
npm run verify
```

Commit sugerido:

```text
chore(obs): add tracing fields and job execution metrics
```

## Regras de handoff entre agentes

- Nao misturar dois checkpoints grandes no mesmo commit.
- Nao mudar schema e webhook e sender em um unico salto sem cobertura.
- Se houver migration, registrar no resumo da sessao.
- Se houver falha, reportar branch, hash, comando e rollback mais seguro.

## Comandos rapidos para retomar

```bash
git status --short --branch
sed -n '1,260p' README.md
sed -n '1,260p' docs/architecture/current.md
sed -n '1,260p' docs/operations/change-control.md
sed -n '1,320p' docs/operations/event-driven-modernization-plan.md
sed -n '1,320p' docs/operations/event-driven-modernization-checkpoints.md
```
