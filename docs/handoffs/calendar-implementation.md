# Handoff: Implementação do Calendário Interno

**Última atualização:** 2026-06-02  
**Status geral:** TODAS AS FASES COMPLETAS ✅ — Agenda pronta para produção

---

## O que foi entregue (resumo total)

### FASE 0 — Schema (✅)
- `professionals` e `rooms` tables no `schema.ts`
- `appointments`: campos `professionalId`, `roomId`, `source`
- Migration `drizzle/0023_tiresome_namorita.sql` **APLICADA EM PRODUÇÃO**
- Entidades, interfaces e repositórios Drizzle para professionals e rooms

### FASE 1 — API de Agendamentos (✅)
- `GET /api/appointments` — lista por período com lead + professional + conversationId
- `POST /api/appointments` — cria via BookingService (GCal + DB + lead.status)
- `PATCH /api/appointments/[id]` — atualiza com efeitos completos (ver abaixo)
- `DELETE /api/appointments/[id]` — cancela via BookingService.cancel()
- `GET /api/leads/search` — busca leads por nome/telefone
- `GET /api/professionals` — lista profissionais da clínica
- `POST /api/professionals` — cria profissional
- `PATCH /api/professionals/[id]` — edita profissional
- `DELETE /api/professionals/[id]` — remove profissional

### FASE 2 — UI do Calendário @schedule-x (✅)
- `CalendarView.tsx` — semana/dia/mês, cores por status, drag-and-drop
- `AppointmentModal.tsx` — criar agendamento com busca de lead + defaultProfessionalId
- `BlockModal.tsx` — criar bloqueio de horário
- `AppointmentDrawer.tsx` — detalhe + ações + link para conversa na Inbox
- `AgendaClient.tsx` — orquestrador com toolbar + view toggle + date nav

### FASE 3 — Multi-profissional (✅)
- `ResourceDayView.tsx` — view "Por profissional" com CSS Grid:
  - Colunas por profissional ativo + coluna "Sem profissional"
  - Eixo de horários 07:00–20:00, scroll horizontal para muitos profissionais
  - Header com scroll sincronizado via JS
  - Indicador "Agora" em emerald atravessando todas as colunas
  - Eventos com borda esquerda colorida pelo profissional + status background
  - Click num slot → abre modal pré-selecionando o profissional da coluna
- `/app/settings/profissionais` — CRUD de profissionais:
  - Accordion inline com nome, especialidade, 8 color swatches, toggle ativo/inativo
  - Confirmação em 2 passos para remoção
  - AddProfessionalForm com preview do avatar + cor
- Link "Profissionais" adicionado ao sidebar (`Users` icon)
- Toolbar da agenda com view tabs: [Semana] [Por profissional]
- Navegação de data (← Hoje → Data) ativada na view "Por profissional"

### FASE 4 — GCal Connector (⏭️ PULADA — implementar futuramente)
Ver seção específica abaixo.

### FASE 5 — Cleanup (✅)
- `BlockForm.tsx` e `actions.ts` legados removidos

---

## Efeitos do PATCH de status (crítico)

O `PATCH /api/appointments/[id]` agora executa efeitos completos:

| Status | GCal | Lead.status | Follow-up |
|--------|------|-------------|-----------|
| `confirmed` | — | — | — |
| `completed` | — | `won` | +6 meses (retorno de rotina) |
| `no_show` | — | `in_conversation` | +7 dias (reengajamento) |
| `cancelled` | ✅ cancela evento | `in_conversation` | — |
| Mudar horário (drag-and-drop) | ✅ PATCH no GCal | — | — |

O cancelamento agora passa pela saga completa do `BookingService.cancel()` mesmo quando feito via PATCH com `{ status: "cancelled" }`.

---

## Arquivos chave

| Arquivo | Descrição |
|---------|-----------|
| `src/app/(clinic)/app/agenda/AgendaClient.tsx` | Orquestrador — toolbar, views, modals |
| `src/app/(clinic)/app/agenda/ResourceDayView.tsx` | View "Por profissional" em CSS Grid |
| `src/app/(clinic)/app/agenda/CalendarView.tsx` | @schedule-x semana/dia/mês |
| `src/app/(clinic)/app/agenda/AppointmentDrawer.tsx` | Drawer detalhe + ações |
| `src/app/(clinic)/app/agenda/AppointmentModal.tsx` | Modal criar com defaultProfessionalId |
| `src/app/(clinic)/app/agenda/agenda-calendar.css` | Todos os estilos da agenda |
| `src/app/(clinic)/app/agenda/types.ts` | AppointmentEvent, Professional (com isActive) |
| `src/app/(clinic)/app/settings/profissionais/` | CRUD de profissionais |
| `src/app/api/appointments/route.ts` | GET (com conversationId) + POST |
| `src/app/api/appointments/[id]/route.ts` | PATCH (efeitos completos) + DELETE |
| `src/app/api/professionals/route.ts` | GET + POST |
| `src/app/api/professionals/[id]/route.ts` | PATCH + DELETE |
| `src/application/use-cases/calendar/update-appointment.ts` | Use case com GCal sync + side effects |
| `src/application/ports/calendar-gateway.ts` | Port com updateCalendarEvent |
| `src/infrastructure/adapters/calendar/google/google-calendar-gateway.ts` | updateCalendarEvent implementado |
| `src/__tests__/UpdateAppointment.test.ts` | 14 testes dos side effects |

---

## Estado dos testes

```
Test Files: 17 passed
Tests: 242 passed (0 failed)
```

---

## FASE 4 — GCal Connector (pendente futura)

**Contexto:** Eventos criados manualmente no GCal não viram appointments no DB.

**O que falta:**
1. Estender webhook `src/app/api/webhooks/google-calendar/route.ts` para sync de eventos novos
2. Método `syncNewEvents(syncToken)` no `GoogleCalendarGateway`
3. Criar appointment com `source: 'gcal_import'` para eventos importados

---

## Próximas entregas sugeridas para a view "Por profissional"

Documentadas em `docs/development/agenda-resource-view.md`.

**Segunda entrega (quando houver profissionais cadastrados em uso real):**
1. Drag-and-drop dentro da coluna (mudar horário)
2. Drag-and-drop entre colunas (trocar profissional)
3. Preview visual de slot inválido + rollback otimista

**Terceira entrega:**
1. Resize de duração
2. Horários de trabalho por profissional (`workSchedule`)
3. Bloqueios por profissional

**Backend (quando expandir para multi-profissional real):**
- `isSlotFree` receber `professionalId` para evitar conflitos por profissional
- `BookingService.book()` salvar `professionalId` no appointment
- Reservas otimistas considerar profissional

---

## Próxima ação operacional

1. Cadastrar profissionais da Ximendes em `/app/settings/profissionais`
2. A tab "Por profissional" aparece automaticamente após o cadastro
3. Testar view "Por profissional" com agendamentos reais

---

## Comandos

```bash
npm run verify          # tipos + 242 testes
npm run verify:agenda   # só testes de agenda
npm run db:migrate      # aplicar migrations (já aplicada a 0023)
```
