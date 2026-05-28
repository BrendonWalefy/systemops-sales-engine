# SystemOps Core — Guia de Arquitetura para o Claude

## Contexto do projeto

SaaS de recepcionista autônoma para clínicas. MVP em produção com piloto real (Ximendes Odontologia). A arquitetura passou por uma refatoração completa (commit `78083ca`) que deve ser preservada.

---

## Regra principal

> **Nunca criar código que contorne, duplique ou quebre os padrões arquiteturais estabelecidos na refatoração `Conversation-First Scheduling Engine`.**

Antes da refatoração, lógica de negócio estava espalhada nas rotas, estado de conversa era inferido a partir de texto de mensagens, e o fluxo de agendamento não tinha garantias de atomicidade. Isso foi corrigido. Não regredir.

## Regra operacional obrigatória

Antes de qualquer mudança, leia e siga `AGENTS.md` e `docs/development/change-control.md`.

- Não trabalhar direto na `main` para features ou ajustes normais.
- Criar branch focada por feature/fix.
- Fazer commits pequenos e reversíveis.
- Rodar `npm run verify` antes de push, PR, merge ou deploy.
- Para agenda/calendário, rodar também `npm run verify:agenda`.
- Não empilhar correções não relacionadas em cima de um deploy instável.

---

## Arquitetura atual

### Fluxo de uma mensagem inbound

```
Z-API webhook → zapi/route.ts (thin adapter)
  → ConversationOrchestrator.handle()
      → RegisterIncomingMessage (use case)
      → ConversationStateMachine.getPendingSlotOffer()
      → IntentClassifier.classify()       ← LLM estágio 1
      → [ação específica por intent]
      → ResponseComposer.compose()        ← LLM estágio 2
      → sendTextMessage()
```

### Camadas (Clean Architecture)

| Camada | Pasta | Regra |
|--------|-------|-------|
| Domain | `src/domain/` | Entidades e interfaces de repositório puras — zero dependências externas |
| Application | `src/application/` | Use cases e ports — orquestra domain, não conhece infra |
| Core | `src/core/` | Pipeline, state machine, scheduling, intelligence — coração do sistema |
| Infrastructure | `src/infrastructure/` | Implementações: Drizzle, Google Calendar, Z-API, OpenAI |
| App (Next.js) | `src/app/` | Rotas HTTP thin — apenas parse de payload e delegate |

---

## O que NUNCA fazer

### Rotas HTTP
- **Não colocar lógica de negócio em `src/app/api/`**. Rotas são adapters: validam payload, chamam um use case ou o Orchestrator, retornam HTTP.
- `zapi/route.ts` tem ~50 linhas e deve continuar assim.

### Estado de conversa
- **Não inferir estado a partir do texto de mensagens** (ex: "se a última mensagem contém 'confirmar'..."). Todo estado fica em `conversation_states` via `ConversationStateMachine`.
- Não usar variáveis em memória, cache local ou campos em outras tabelas para guardar estado de conversa.

### LLM / IA
- **Não criar novas chamadas LLM fora de `IntentClassifier` e `ResponseComposer`**. Se um novo comportamento de IA for necessário, estender um desses ou criar um novo componente em `src/core/intelligence/`.
- `IntentClassifier` **classifica apenas** — não compõe texto de resposta.
- `ResponseComposer` **compõe apenas** — não toma decisões de negócio.
- Schemas de `response_format` com `strict: true` exigem que todos os campos de `properties` estejam em `required`. Campos opcionais usam `anyOf: [{ type }, { type: "null" }]`.

### Agendamento
- **Não criar eventos no Google Calendar diretamente**. Usar `BookingService.book()` que garante a saga: reserva otimista → Calendar → confirmação → banco.
- Não chamar `calendarGateway.createAppointment()` fora do `BookingService`.
- Toda operação com fuso horário passa por `ClinicTimezone` — não usar `new Date()` com offset manual.

### Banco de dados
- **Não escrever SQL raw ou queries Drizzle fora dos repositórios em `src/infrastructure/repositories/`**. Exceções: migrações e scripts pontuais de manutenção.
- Nunca alterar schema sem gerar migration (`npm run db:generate`).
- Migrations geradas não são editadas manualmente.

### Configuração de clínica
- Comportamento da IA (playbook, tom de voz, política comercial, horários) vem do banco — campos da tabela `clinics`. Não hardcodar esses valores no código.

---

## Padrões obrigatórios ao adicionar features

### Nova intenção do lead
1. Adicionar o tipo em `IntentType` no `IntentClassifier.ts`
2. Adicionar ao enum do `RESPONSE_SCHEMA`
3. Adicionar case no switch do `ConversationOrchestrator`
4. Adicionar handler em `ResponseComposer` se necessário

### Novo estado de conversa
1. Adicionar em `ConversationStateType` no `ConversationStateMachine.ts`
2. Criar método de transição nomeado (ex: `offerSlots`, `confirmBooking`)
3. Usar `stateMachine.transition()` — nunca inserir direto na tabela

### Nova entidade no banco
1. Adicionar em `src/infrastructure/db/schema.ts`
2. Gerar migration: `npm run db:generate`
3. Criar interface de repositório em `src/domain/repositories/`
4. Implementar em `src/infrastructure/repositories/`
5. Aplicar migration em produção antes do deploy

### Follow-up de re-engajamento
A infraestrutura já existe (`follow_ups` table, `CreateFollowUp` use case, `FollowUpRepository.listDue()`). Ao implementar:

1. **FollowUpScheduler** — chamar via `BookingService` nos eventos: `completed` (+6 meses), `no_show` (+7 dias), lead `lost` (+30 dias). Localização: `src/application/use-cases/leads/schedule-follow-up.ts`
2. **FollowUpDispatcher** — Vercel Cron diário em `src/app/api/cron/follow-up-dispatcher/route.ts`, protegido por `CRON_SECRET`. Fluxo: `listDue` → gera mensagem via `ResponseComposer` (novo ActionResult `reengagement`) → envia via Z-API → marca `done`
3. **Não enviar mensagem diretamente na rota** — usar `ResponseComposer` para gerar o texto, garantindo tom de voz da clínica
4. **Não criar agendamento automático** — o follow-up apenas inicia a conversa; o lead passa pelo fluxo normal do `ConversationOrchestrator`

---

## Stack de referência

- **Runtime**: Next.js 14 App Router, Node.js
- **Banco**: Neon (PostgreSQL) via Drizzle ORM
- **IA**: OpenAI `gpt-4o-mini` (classifier + composer)
- **Calendário**: Google Calendar API via service account
- **WhatsApp**: Z-API
- **Deploy**: Vercel (auto-deploy do `main`)
- **Migrations**: `drizzle-kit` — nunca `drizzle-kit push` em produção, sempre `migrate`
