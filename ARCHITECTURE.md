# SystemOps Core — Arquitetura

## Visão Geral

Sistema de recepcionista virtual para clínicas, construído com Next.js 15, PostgreSQL (Drizzle ORM) e OpenAI. O fluxo central é: lead envia mensagem via WhatsApp → sistema classifica intenção → executa ação (agenda/cancela/consulta) → compõe resposta humanizada → envia.

---

## Princípio de Design

> **O LLM entende. O sistema decide. O LLM verbaliza.**

O pipeline é dividido em dois estágios de LLM separados:

1. **IntentClassifier** — Classifica intenção da mensagem em JSON estruturado. Rápido, barato, zero texto livre.
2. **ResponseComposer** — Humaniza o resultado de uma ação já executada. Nunca inventa dados.

Entre os dois, o `ConversationOrchestrator` executa a ação real (consulta agenda, reserva slot, cria evento) e passa o resultado para o Composer.

---

## Estrutura de Pastas

```
src/
├── core/                          ← lógica de negócio central
│   ├── scheduling/
│   │   ├── ClinicTimezone.ts      ← único ponto de timezone (Intl nativo, configurável por clínica)
│   │   ├── SlotEngine.ts          ← pure function: config + eventos → slots disponíveis
│   │   ├── SlotReservationService.ts  ← lock otimista anti-double-booking (TTL no banco)
│   │   └── BookingService.ts      ← saga: reserva → Calendar → confirma → notifica
│   │
│   ├── conversation/
│   │   └── ConversationStateMachine.ts  ← estado explícito no banco (substitui marcadores em texto)
│   │
│   ├── intelligence/
│   │   ├── IntentClassifier.ts    ← LLM estágio 1: intenção → JSON
│   │   └── ResponseComposer.ts    ← LLM estágio 2: resultado → texto humano
│   │
│   └── pipeline/
│       └── ConversationOrchestrator.ts  ← orquestrador central do fluxo
│
├── domain/                        ← entidades de domínio (tipos puros)
├── application/                   ← use cases e ports
├── infrastructure/                ← adaptadores externos (DB, Google Calendar, WhatsApp, LLM)
└── app/                           ← Next.js routes e UI
```

---

## Fluxo de uma Mensagem

```
Lead envia mensagem (WhatsApp)
        │
        ▼
[Webhook — /api/whatsapp/zapi ou /webhook]
  Normaliza payload do provider (Z-API ou Meta Cloud)
  Chama ConversationOrchestrator.handle()
        │
        ▼
[ConversationOrchestrator]
  1. Deduplicação por messageId (idempotência)
  2. Busca clínica + ClinicTimezone configurada
  3. RegisterIncomingMessage → cria/atualiza lead e conversa
  4. Verifica oferta de slots pendente (ConversationStateMachine)
  5. IntentClassifier.classify() → intent + entities
  6. Switch no intent → executa ação:
     │
     ├── confirm_slot     → BookingService.book() → saga atômica
     ├── check_availability / book_appointment
     │                    → GoogleCalendarGateway → SlotEngine → StateMachine.offerSlots()
     ├── cancel_appointment → BookingService.cancel()
     ├── reschedule       → cancel + nova oferta
     ├── list_appointments → appointmentRepo.findActiveByLeadId()
     ├── clinical_urgency → notifica receptionist
     └── general/unclear  → passa contexto para composer
  7. ResponseComposer.compose() → texto humanizado
  8. sendTextMessage() — uma única mensagem ao lead
  9. Salva mensagem do agente + custos
```

---

## Componentes Principais

### `ClinicTimezone` (`src/core/scheduling/ClinicTimezone.ts`)

Única fonte de verdade para conversão de timezone. Usa `Intl.DateTimeFormat` nativo — sem biblioteca externa.

```typescript
const tz = new ClinicTimezone("America/Sao_Paulo");
tz.toLocalParts(utcDate)        // → { year, month, day, hour, minute, weekday }
tz.fromLocalParts(y, m, d, h)  // → Date UTC
tz.formatForHuman(utcDate)     // → "Seg 26/05 às 14h"
tz.isBusinessHour(utcDate, bh) // → boolean
```

O timezone é configurado por clínica na coluna `clinics.timezone` (IANA zone string, ex: `"America/Sao_Paulo"`).

### `SlotEngine` (`src/core/scheduling/SlotEngine.ts`)

Pure function — sem I/O. Recebe eventos existentes do calendário e retorna slots livres. Completamente testável com Jest puro.

```typescript
const slots = computeAvailableSlots({
  timezone, businessHours, existingEvents, from, to, slotDurationMinutes, clinicId
});
```

### `ConversationStateMachine` (`src/core/conversation/ConversationStateMachine.ts`)

Substitui os marcadores `__calendar_slots__:` em corpos de mensagem. O estado da conversa fica na tabela `conversation_states` — auditável, com TTL, recuperável.

**Estados:** `idle` → `slots_offered` → `awaiting_confirmation` → `booking_pending`

```typescript
await stateMachine.offerSlots(conversationId, slots, timezone); // salva com TTL 15min
await stateMachine.getPendingSlotOffer(conversationId);         // null se expirado
await stateMachine.invalidate(conversationId);                  // volta para idle
```

### `BookingService` (`src/core/scheduling/BookingService.ts`)

Saga de agendamento com compensação. Garante atomicidade entre banco e Google Calendar.

```
Passo 1: SlotReservationService.reserve()   → lock otimista (falha se tomado → "slot_taken")
Passo 2: CalendarGateway.createAppointment() → evento no Google Calendar
Passo 3: SlotReservationService.confirm()    → marca slot como permanentemente confirmado
Passo 4: AppointmentRepository.save()        → persiste no banco
Passo 5: LeadRepository.save()              → atualiza status do lead
```

Se passo 2 falhar, a reserva expira por TTL automaticamente — sem rollback manual necessário.

### `IntentClassifier` (`src/core/intelligence/IntentClassifier.ts`)

GPT-4o-mini com `response_format: json_schema`. Retorna estrutura tipada, não texto livre.

**Intents:** `book_appointment`, `check_availability`, `confirm_slot`, `reject_slots`, `cancel_appointment`, `reschedule_appointment`, `list_appointments`, `price_inquiry`, `clinical_urgency`, `general_question`, `greeting`, `unclear`

### `ResponseComposer` (`src/core/intelligence/ResponseComposer.ts`)

GPT-4o-mini com temperatura 0.7. Recebe `ActionResult` (resultado concreto já computado) e gera texto humanizado. **Nunca inventa horários** — apenas verbaliza dados reais.

---

## Banco de Dados

### Tabelas Novas (migration `0004_striped_firedrake.sql`)

**`conversation_states`** — Estado da conversa, com TTL. Substitui marcadores em texto.
```sql
id, conversation_id, state, payload (jsonb), created_at, expires_at
```

**`slot_reservations`** — Lock otimista de slots. Previne double-booking.
```sql
id, clinic_id, lead_id, starts_at, ends_at, status, calendar_event_id, expires_at, created_at
```

### Coluna Nova em `clinics`

```sql
timezone text NOT NULL DEFAULT 'America/Sao_Paulo'
```

---

## Anti-Double-Booking

O `SlotReservationService` faz verificação explícita no banco antes de criar qualquer evento:

```
reserva = await reservationService.reserve(clinicId, leadId, startsAt, endsAt)
if (!reserva) → slot tomado por outro lead → oferecer alternativas
```

A verificação checa slots `pending` ou `confirmed` com `startsAt` coincidente. Reservas `pending` expiram por TTL (10 minutos) se o fluxo não for concluído.

---

## Timezone

Toda a lógica de timezone passa exclusivamente por `ClinicTimezone`. **Não há offset hardcoded em nenhum arquivo.**

- `clinics.timezone` → IANA zone string configurado por clínica
- `GoogleCalendarGateway` recebe `ClinicTimezone` como parâmetro
- `SlotEngine` usa `ClinicTimezone` para verificar horário comercial
- `IntentClassifier` e `ResponseComposer` recebem o fuso para formatar datas
- Google Calendar API recebe datas em UTC (`.toISOString()`) — correto por padrão

---

## Multi-tenant

Cada clínica tem seu próprio:
- `timezone` (IANA zone)
- `businessHours` (texto parseado por `parseBusinessHours()`)
- `googleCalendarId` (calendar dedicado)
- `playbook` (só afeta o ResponseComposer — não a lógica de scheduling)
- `toneOfVoice` (só afeta o ResponseComposer)

O playbook e o tom de voz **nunca afetam** a lógica de verificar disponibilidade, reservar ou confirmar agendamentos. Essa separação garante que a experiência do lead seja consistente independente do que está no playbook.

---

## Webhooks

Ambos os webhooks (`/api/whatsapp/zapi` e `/api/whatsapp/webhook`) são thin adapters:

1. Normalizam o payload do provider (Z-API ou Meta Cloud API)
2. Verificam `autoReplyEnabled` da clínica
3. Chamam `ConversationOrchestrator.handle()`
4. Retornam 200

Toda lógica de negócio está no Orchestrator.

---

## Variáveis de Ambiente Necessárias

```env
DATABASE_URL=                          # PostgreSQL connection string
OPENAI_API_KEY=                        # OpenAI API key
GOOGLE_SERVICE_ACCOUNT_EMAIL=          # Google service account
GOOGLE_PRIVATE_KEY=                    # Google private key (PEM, escaped \n)
GOOGLE_CALENDAR_ID=                    # Calendar ID padrão (sobrescrito por clinics.googleCalendarId)
PILOT_CLINIC_ID=                       # ID da clínica do piloto
WHATSAPP_PROVIDER=z_api                # "z_api" ou "meta_cloud_api"
ZAPI_INSTANCE_ID=                      # Z-API instance
ZAPI_TOKEN=                            # Z-API token
ZAPI_CLIENT_TOKEN=                     # Z-API client token (opcional)
WHATSAPP_VERIFY_TOKEN=                 # Token de verificação Meta webhook
RECEPTIONIST_PHONE_NUMBER=             # Número para notificações de handoff/urgência
```

---

## Como Rodar Migrations

```bash
npm run db:generate   # gera SQL a partir do schema
npm run db:migrate    # aplica no banco (requer DATABASE_URL em .env.local)
```
