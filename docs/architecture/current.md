# Arquitetura Atual

Este documento descreve a arquitetura viva do SystemOps Core. Historico, prompts de implementacao e planos antigos nao devem ser usados como fonte de verdade.

## Principio Central

O LLM entende e verbaliza; o sistema decide.

- `IntentClassifier` classifica a mensagem em JSON estruturado.
- `ConversationOrchestrator` aplica regras deterministicas e executa a acao real.
- `ResponseComposer` transforma o resultado concreto em texto humano.

Playbook e tom de voz influenciam comunicacao. Eles nao podem alterar regra de agenda, reserva, disponibilidade, tenant ou seguranca.

## Fluxo de Mensagem

```text
WhatsApp Z-API
  -> /api/whatsapp/zapi
  -> resolveClinicByZapiInbound()
  -> ConversationOrchestrator.handle()
     -> RegisterIncomingMessage
     -> ConversationStateMachine
     -> IntentClassifier
     -> regra deterministica por intent
     -> BookingService / repositories / CalendarGateway resolvido por clinic.calendarMode
     -> ResponseComposer
     -> sendTextMessage()
```

O endpoint Meta Cloud API (`/api/whatsapp/webhook`) existe como compatibilidade, mas a producao atual usa Z-API.

## Camadas

| Camada | Pasta | Responsabilidade |
| --- | --- | --- |
| Domain | `src/domain/` | Entidades, value objects e contratos de repositorio |
| Application | `src/application/` | Use cases, ports e servicos de aplicacao |
| Core | `src/core/` | Pipeline de conversa, agenda, state machine e inteligencia |
| Infrastructure | `src/infrastructure/` | Drizzle, calendario interno/Google Calendar, Z-API, OpenAI, push |
| App | `src/app/` | UI Next.js, route handlers e server actions |

Route handlers devem ser adapters finos: validar entrada, resolver contexto e delegar.

## Multi-Tenancy

Cada clinica possui sua propria configuracao no banco:

- credenciais Z-API;
- modo de calendario (`calendarMode`);
- Google Calendar ID opcional;
- timezone;
- horarios comerciais;
- profissionais;
- tratamentos;
- playbook;
- tom de voz;
- flags como `autoReplyEnabled`.

Nao existe fallback global de Z-API, calendario ou usuario de clinica por env.

Para QA real sem nova instancia Z-API, `whatsapp_qa_routes` pode desviar
telefones allowlistados: a conversa, o lead, a agenda e os custos vivem na
clinica fake alvo; o envio WhatsApp usa a clinica fonte dona da instancia.
Sem rota ativa, a instancia continua resolvendo para a propria clinica.

## Autenticacao

- Owner: `OWNER_EMAIL` + `OWNER_PASSWORD`.
- Clinica: membros em `clinic_members`, com `password_hash`.
- Sessao: token HMAC assinado por `SESSION_SECRET`.

Usuarios de clinica devem ser criados pelo owner/onboarding/scripts. Nao reintroduza `ADMIN_EMAIL` ou `ADMIN_PASSWORD` globais.

## Agenda e Reservas

Componentes principais:

- `ClinicTimezone`: unica fonte para conversao e formatacao de fuso.
- `SlotEngine`: pure function para disponibilidade.
- `InternalCalendarGateway`: usa `appointments` + `calendar_blocks` no banco como fonte de verdade.
- `GoogleCalendarGateway`: modo opt-in/legado para clinicas que mantem GCal como fonte de disponibilidade.
- `resolveCalendarGateway`: escolhe o gateway por `clinics.calendarMode` e, quando nulo, deriva de `googleCalendarId`.
- `SlotReservationService`: lock otimista anti-double-booking.
- `BookingService`: saga reserva -> CalendarGateway -> banco.

Nao crie agendamentos diretamente no Google Calendar fora do `BookingService`. Bloqueios devem passar pela port `CalendarGateway`.

## Estado de Conversa

Estado operacional fica em `conversation_states`, via `ConversationStateMachine`.

Nao inferir estado a partir de texto de mensagem, marcadores escondidos, cache local ou variaveis em memoria.

## Inteligencia

Pontos autorizados de LLM:

- `src/core/intelligence/IntentClassifier.ts`
- `src/core/intelligence/ResponseComposer.ts`
- `src/core/intelligence/PlaybookAdvisor.ts`
- `src/infrastructure/adapters/ai/whisper-gateway.ts`

Novas chamadas de IA devem entrar em `src/core/intelligence/` ou em adapter explicitamente isolado, com testes quando afetarem decisao.

## Banco e Migrations

Fonte de schema: `src/infrastructure/db/schema.ts`.

Historico de migrations:

- baseline reprodutivel em `drizzle/0000_baseline.sql`;
- snapshots em `drizzle/meta/`;
- novas alteracoes devem usar `npm run db:generate`;
- producao deve usar `npm run db:migrate` ou fluxo equivalente do deploy.

Nunca usar `drizzle-kit push` em producao.

## Variaveis de Ambiente

Env e para infraestrutura compartilhada:

- banco;
- sessao;
- owner;
- OpenAI;
- Google service account;
- cron/toggles;
- push notifications;
- simulate API.

Configuracao de clinica pertence ao banco.

## Testes de Maior Risco

Ao mexer em agenda/calendario:

```bash
npm run verify:agenda
```

Ao mexer em pipeline WhatsApp, estados, intents, leads ou banco:

```bash
npm run verify
```
