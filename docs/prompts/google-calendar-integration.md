# Prompt: Integração Google Calendar

## Contexto do projeto

Projeto: **systemops-core** — SaaS de recepcionista IA para clínicas odontológicas.
Stack: Next.js 16 App Router, Drizzle ORM, TypeScript, Postgres (Neon), deploy no Vercel.
Path alias: `@/` aponta para `src/`.

O sistema já possui:
- Webhook Z-API recebendo mensagens WhatsApp em `src/app/api/whatsapp/zapi/route.ts`
- IA (GPT-4o-mini) respondendo leads via `src/infrastructure/adapters/agents/llm-sales-agent-gateway.ts`
- Schema do banco em `src/infrastructure/db/schema.ts`
- Adapter do Google Calendar **não implementado** em `src/infrastructure/adapters/calendar/google/google-calendar-gateway.ts`
- Port (interface) já definida em `src/application/ports/calendar-gateway.ts`
- Use cases já criados (sem implementação): `src/application/use-cases/calendar/suggest-appointment-slots.ts` e `src/application/use-cases/calendar/schedule-appointment.ts`
- Tabela `appointments` já existe no schema com campos: id, clinicId, leadId, calendarEventId, startsAt, endsAt, status

## O que o usuário já configurou

- Conta Google Cloud criada com projeto "SystemOps"
- Google Calendar API ativada
- Service Account criada com e-mail e chave JSON baixada
- Agenda da clínica piloto compartilhada com o e-mail da service account
- Env vars no Vercel já configuradas:
  - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
  - `GOOGLE_PRIVATE_KEY` (conteúdo do campo private_key do JSON, com \n reais)
  - `GOOGLE_CALENDAR_ID` (e-mail da agenda da clínica ou ID do Google Calendar)

## O que precisa ser construído

### 1. Implementar o GoogleCalendarGateway

Arquivo: `src/infrastructure/adapters/calendar/google/google-calendar-gateway.ts`

Usar a Google Calendar API via REST (sem SDK — só `fetch`) com autenticação via JWT (Service Account).

**Método `listAvailableSlots`:**
- Busca eventos na agenda entre `from` e `to` via `GET /calendars/{calendarId}/events`
- Retorna slots de 1h disponíveis dentro do horário comercial (8h-18h, seg-sex)
- Exclui horários já ocupados por eventos existentes
- Retorna no máximo 5 slots

**Método `createAppointment`:**
- Cria evento via `POST /calendars/{calendarId}/events`
- Título do evento: nome do lead + procedimento (ex: "Maria Silva — Avaliação Lentes de Resina")
- Descrição: telefone do lead
- Duração: 1 hora
- Retorna o `calendarEventId` do evento criado

**Autenticação JWT com Service Account (sem SDK):**
```
- Header: { alg: "RS256", typ: "JWT" }
- Payload: { iss, scope, aud, exp, iat }
- Scope: https://www.googleapis.com/auth/calendar
- Assinar com a private_key usando crypto.subtle (Web Crypto API — não usar node:crypto)
- Trocar JWT por access_token via POST https://oauth2.googleapis.com/token
- Cachear o token em memória com expiração
```

### 2. Integrar o agendamento no webhook Z-API

Arquivo: `src/app/api/whatsapp/zapi/route.ts`

Quando `decision.stage === "ready_to_schedule"`:
1. Buscar os próximos slots disponíveis no Google Calendar (próximos 5 dias úteis)
2. Formatar até 3 opções de horário em português (ex: "Terça 27/05 às 10h")
3. Enviar mensagem no WhatsApp com as opções numeradas para o lead escolher
4. Salvar na tabela `appointments` com status `scheduled` quando o lead responder com um número

**Detecção da resposta do lead:**
- Se a mensagem do lead for "1", "2" ou "3" E o lead tiver status `appointment_scheduled` pendente → confirmar o slot escolhido
- Criar o evento no Google Calendar
- Atualizar o `appointment` no banco com o `calendarEventId`
- Enviar mensagem de confirmação com data e horário

### 3. Adicionar campo googleCalendarId na tabela clinics

Criar migration Drizzle:
```
alterTable clinics add column google_calendar_id text
```

Arquivo: nova migration em `src/infrastructure/db/migrations/`

Atualizar o schema em `src/infrastructure/db/schema.ts` adicionando o campo `googleCalendarId: text("google_calendar_id")` na tabela `clinics`.

Para o piloto, usar a env var `GOOGLE_CALENDAR_ID` como fallback quando `clinic.googleCalendarId` for null.

### 4. Mostrar agendamentos no Inbox

Arquivo: `src/app/(admin)/inbox/[conversationId]/page.tsx`

No painel lateral do lead, adicionar seção "Agendamento" que mostra:
- Se houver appointment com status `scheduled` ou `confirmed`: data/hora + link para o Google Calendar
- Se não houver: botão "Ver disponibilidade" que faz fetch dos próximos slots e mostra na tela

### 5. Atualizar o prompt da IA

Arquivo: `src/infrastructure/adapters/agents/llm-sales-agent-gateway.ts`

Adicionar ao `BASE_RULES`:
- Quando o lead confirmar interesse em agendar e o sistema oferecer slots, a IA deve aguardar a escolha e confirmar com entusiasmo
- Não oferecer horários inventados — apenas confirmar os que o sistema enviou

## Env vars necessárias (já devem estar no Vercel)

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=systemops@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
GOOGLE_CALENDAR_ID=clinica@gmail.com
```

## Restrições

- Usar Web Crypto API (`crypto.subtle`) para assinar o JWT — NÃO usar `node:crypto` (incompatível com Edge Runtime)
- NÃO instalar googleapis SDK — usar fetch puro (evita bundle pesado)
- Sempre commitar antes de fazer push
- Type-check (`npx tsc --noEmit`) deve passar sem erros antes do commit
- Seguir o design system existente em `src/app/globals.css` para qualquer UI nova
- O `GOOGLE_CALENDAR_ID` por clínica vem de `clinic.googleCalendarId` — com fallback para env var no piloto

## Critério de sucesso

1. Lead chega via WhatsApp → IA conversa normalmente
2. Quando lead demonstra interesse real → sistema busca slots no Google Calendar da clínica
3. IA envia 3 opções de horário reais da agenda
4. Lead responde com "1", "2" ou "3" → evento criado automaticamente no Google Calendar
5. Lead recebe confirmação com data e hora
6. Agendamento aparece no painel Inbox do admin
