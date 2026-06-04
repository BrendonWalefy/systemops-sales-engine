# Estratégia de Calendário — Interno vs. Google Calendar

> Documento de decisão arquitetural e produto. Atualizado em 2026-06-04.

---

## O problema

Existem dois "calendários" percebidos no sistema, mas eles são camadas diferentes, não paralelas:

```
[/app/agenda — UI @schedule-x]
    ↑
    │ lê do banco de dados (tabela appointments)
    │
[PostgreSQL DB] ←——→ [Google Calendar (GCal)]
                              ↑
                              │ fonte de verdade atual para SLOTS
                              │ SlotEngine + IA booking flow
```

**Camada 1 — UI Interna (@schedule-x):** renderiza os `appointments` do banco. Funciona sem GCal.

**Camada 2 — Google Calendar (backend):** é de onde o `SlotEngine` busca horários disponíveis para oferecer ao paciente no WhatsApp. Sem GCal configurado, a IA não consegue oferecer slots.

---

## Estado de sincronização hoje

| Ação | Sincronizado? | Mecanismo |
|------|:---:|-----------|
| Criar agendamento (UI) → GCal | ✅ | `BookingService.book()` chama `createAppointment()` |
| Cancelar (UI) → GCal | ✅ | `cancelAppointment()` deleta o evento GCal |
| Drag-and-drop (UI) → GCal | ✅ | `updateCalendarEvent()` via PATCH no GCal |
| Deletar no GCal → DB | ❌ | Fase 4 (webhook) ainda não construída |
| Criar evento no GCal → aparecer na UI | ❌ | Fase 4 pendente |

**Gap crítico:** Se uma clínica não tiver `googleCalendarId` configurado, o `SlotEngine` falha silenciosamente e a IA não agenda. A UI funciona, a IA não.

---

## Decisão recomendada: `calendarMode` por clínica

Adicionar campo `calendarMode: "internal" | "google_calendar"` na tabela `clinics`.

### Modo `"internal"` (padrão para clínicas novas)

- @schedule-x + banco de dados é o sistema completo
- `InternalCalendarGateway` (novo) implementa a mesma port `CalendarGateway`
- Slots calculados a partir de `professionals.workSchedule` + `appointments` no banco
- Zero dependência de GCal
- Ideal para: maioria das clínicas, onboarding simples, produto standalone

### Modo `"google_calendar"`

- Comportamento atual: GCal é fonte de verdade para disponibilidade
- Fase 4 (webhook bidirecional) habilita sync reverso (GCal → DB)
- Indicado para: clínicas que já usam GCal extensivamente e não querem migrar

> **Por que não ter botão de sincronizar manual?**
> Sync pontual cria janelas de inconsistência. A solução correta é definir qual é a fonte de verdade e manter sync contínuo via webhook. Um botão de "importar do GCal" faz sentido apenas no onboarding inicial (carregar agendamentos históricos).

---

## Análise de riscos

### Fase A — `InternalCalendarGateway` (habilitar modo interno)

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:---:|:---:|-----------|
| Lógica de slots divergir do GCal | Médio | Alto | Cobrir `InternalCalendarGateway.listAvailableSlots()` com testes unitários usando fixtures de workSchedule |
| Ximendes (GCal configurado) ser afetada | Baixo | Alto | `calendarMode` default `"internal"` só se aplica a clínicas sem `googleCalendarId`; Ximendes mantém comportamento atual |
| `BookingService` receber gateway errado | Baixo | Alto | Injeção de dependência explícita por `clinicId`; teste de integração verifica qual gateway é resolvido |
| Conflito de agendamento não detectado no modo interno | Médio | Alto | Manter DB overlap check (já existe); adicionar índice composto em `(clinicId, professionalId, startsAt, endsAt)` |
| `workSchedule` de profissionais não preenchido | Alto | Médio | Fallback para `businessHours` da clínica se `workSchedule` for null |

### Fase B — GCal Connector completo (webhook bidirecional)

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:---:|:---:|-----------|
| Webhook duplicado (GCal envia evento duas vezes) | Médio | Médio | Idempotência por `calendarEventId`; já temos `calendarSyncToken` |
| Watch channel expirar sem renovar | Médio | Alto | Cron 24h já existe; adicionar alerta se renovação falhar |
| Evento criado no GCal sem `leadId` | Alto | Médio | `source: "gcal_import"` no appointment; mostrar como "Importado do GCal" na UI sem lead linkado |
| Conflito de edição simultânea (UI + GCal) | Baixo | Médio | Last-write-wins; aceitar como comportamento esperado; documentar |

### Fase C — Multi-profissional

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:---:|:---:|-----------|
| Settings CRUD de profissionais sem validação de `workSchedule` | Médio | Médio | Validar JSON no server action antes de salvar |
| Resource view do @schedule-x com dados inconsistentes | Baixo | Baixo | View já tem fallback para "sem profissional" |

---

## O que NÃO quebrará hoje

- **UI da agenda** (`/app/agenda`): independente de GCal; não muda nas Fases A/C
- **Agendamentos existentes da Ximendes**: `calendarMode` da Ximendes ficará `"google_calendar"` (tem `googleCalendarId` configurado); sem alteração de comportamento
- **IA de agendamento da Ximendes**: continua usando GCal; sem alteração
- **Lembretes D-1**: baseados em `appointments.startsAt`; não dependem de GCal
- **Follow-up re-engajamento**: baseado em `appointments.status`; não dependem de GCal
- **Takeover / Smart Inbox**: sem relação com calendário

---

## Estimativas de tempo

| Fase | O que é | Estimativa | Pré-requisito |
|------|---------|:---:|---------------|
| **A** | `calendarMode` no schema + `InternalCalendarGateway` + DI + testes | 2 dias | Nenhum |
| **C** | Settings CRUD de profissionais + resource view | 1–2 dias | Fase A (usa mesma DI) |
| **B** | GCal webhook bidirecional + cron renewal + import inicial | 1–2 dias | Independente de A e C |

**Total estimado:** 4–6 dias de desenvolvimento.

**Sequência recomendada:**
1. Fase A → desbloqueia todas as clínicas novas sem GCal
2. Fase C → necessário para múltiplos profissionais (Ximendes)
3. Fase B → somente se uma clínica futura exigir GCal bidirecional

---

## Arquivos críticos

| Arquivo | Papel |
|---------|-------|
| `src/infrastructure/db/schema.ts` | Adicionar `calendarMode` em `clinics` |
| `src/application/ports/calendar-gateway.ts` | Port que `InternalCalendarGateway` deve implementar |
| `src/infrastructure/adapters/calendar/google/google-calendar-gateway.ts` | Referência de implementação |
| `src/core/scheduling/BookingService.ts` | Recebe gateway via DI; precisa resolver gateway por clinicId |
| `src/core/scheduling/SlotEngine.ts` | Usa gateway para listar slots |
| `src/app/api/appointments/route.ts` | Endpoint de criação usa BookingService |
| `src/infrastructure/db/schema.ts` linha professionals | `workSchedule` (jsonb) é a fonte de disponibilidade no modo interno |

---

## Verificação de ponta a ponta

1. Clínica sem GCal → IA oferece horários baseados em `workSchedule` do profissional
2. Clínica com GCal → comportamento atual preservado; nenhum agendamento perdido
3. Settings: toggle `calendarMode` persiste e muda o gateway usado em tempo real
4. Conflito de horário no modo interno detectado corretamente (dois pacientes no mesmo slot)
5. Lembrete D-1 disparado para appointments criados via modo interno
