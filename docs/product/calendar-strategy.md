# Estratégia de Calendário — Interno vs. Google Calendar

> Documento de decisão arquitetural e produto. Atualizado em 2026-06-05.

---

## O Modelo Atual

Existe uma UI interna de agenda e existe uma integração opcional com Google Calendar. A fonte de verdade depende de `clinics.calendarMode`:

```
[/app/agenda — UI @schedule-x]
    ↑
    │ lê appointments e bloqueios internos do banco
    │
[PostgreSQL DB]
    ↑
    │ modo internal: fonte de verdade para slots, agendamentos e bloqueios
    │
[InternalCalendarGateway + SlotEngine + IA]

[Google Calendar (GCal)]
    ↑
    │ modo google_calendar: opt-in/legado para disponibilidade externa
    │
[GoogleCalendarGateway + SlotEngine + IA]
```

**Modo `internal`:** o banco é a fonte de verdade. Disponibilidade = `businessHours` da clínica menos `appointments` ativos e `calendar_blocks`.

**Modo `google_calendar`:** Google Calendar segue como fonte opt-in/legado para disponibilidade externa. O banco mantém os `appointments` do produto.

---

## Estado de sincronização

| Ação | Sincronizado? | Mecanismo |
|------|:---:|-----------|
| Criar agendamento no modo `internal` | ✅ | `BookingService.book()` salva `appointments`; gateway interno não cria evento externo |
| Criar bloqueio no modo `internal` | ✅ | `calendar_blocks` |
| Cancelar/reagendar no modo `internal` | ✅ | `appointments` no banco |
| Criar/cancelar/reagendar no modo `google_calendar` | ✅ | `GoogleCalendarGateway` + persistência em `appointments` |
| Cancelar evento diretamente no GCal → DB | ⚠️ parcial | Webhook atual sincroniza cancelamentos apenas no modo `google_calendar` |
| Criar/editar evento diretamente no GCal → DB | ❌ | Fase B (sync reverso completo) ainda não construída |

**Gap crítico de rollout:** ao mudar uma clínica com histórico no GCal para `internal`, os eventos e bloqueios relevantes precisam existir no banco antes de a IA oferecer horários. A alternativa operacional é assumir explicitamente uma agenda nova.

---

## Status de implementação (atualizado)

- ✅ **Fase A implementada.** `calendarMode` (`internal` | `google_calendar`, nullable) na
  tabela `clinics`; `InternalCalendarGateway` reusa o `SlotEngine`; resolver único
  (`resolveCalendarGateway`) escolhe o gateway; consumidores de booking/agenda usam a port.
- ✅ **Ximendes opera 100% no modo interno** (`calendar_mode = 'internal'`), via migração e seed.
- ✅ **Bloqueios first-class** na tabela `calendar_blocks` (sem lead falso). No modo interno
  vivem no banco; no modo google_calendar continuam como eventos no GCal.
- ✅ **Testes**: conflito/double booking (reserva + overlap no banco), bloqueio, timezone,
  buffer, filtro por profissional, cancelamento e pipeline de oferta de slots.
- ⏳ **Fase B (GCal espelho/sync completo)** e **Fase C (multi-profissional + salas)**: ver abaixo.

---

## Decisão Implementada: `calendarMode` por clínica

Campo `calendarMode: "internal" | "google_calendar"` na tabela `clinics`.

### Modo `"internal"` (padrão para clínicas novas)

- @schedule-x + banco de dados é o sistema completo
- `InternalCalendarGateway` implementa a mesma port `CalendarGateway`
- Slots calculados a partir de `businessHours` + `appointments` + `calendar_blocks`
- Zero dependência de GCal
- Ideal para: clínicas de recurso único, onboarding simples, produto standalone
- `professionals.workSchedule`, salas e multi-profissional entram na Fase C

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
| Lógica de slots divergir do GCal | Médio | Alto | Cobrir `InternalCalendarGateway.listAvailableSlots()` com testes unitários usando `businessHours`, appointments, bloqueios e timezone |
| Ximendes (GCal configurado) ser afetada | Médio | Alto | Ximendes fica com `calendarMode = "internal"` de forma explícita; antes de liberar a IA, garantir que eventos/bloqueios relevantes existam no banco |
| `BookingService` receber gateway errado | Baixo | Alto | Injeção de dependência explícita por `clinicId`; teste de integração verifica qual gateway é resolvido |
| Conflito de agendamento não detectado no modo interno | Médio | Alto | Manter DB overlap check (já existe); adicionar índice composto em `(clinicId, professionalId, startsAt, endsAt)` |
| Clínica multi-profissional usar modo interno antes da Fase C | Médio | Alto | Manter Fase A restrita a clínica de recurso único; documentar limite e validar no onboarding |

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

## Cuidados de rollout

- **UI da agenda** (`/app/agenda`): independente de GCal; não muda nas Fases A/C
- **Ximendes**: `calendarMode` fica `"internal"` mesmo com `googleCalendarId` preenchido. Eventos e bloqueios que existiam só no GCal deixam de decidir disponibilidade; precisam ser importados/recriados no banco ou a operação precisa assumir agenda nova.
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
2. Fase C → necessária antes de vender modo interno para clínicas multi-profissionais/salas
3. Fase B → somente se uma clínica futura exigir GCal bidirecional

---

## Fase C — multi-profissional e salas (design, ainda não implementado)

Implantar quando surgir a segunda clínica com 2+ profissionais. A preocupação central
é modelar uma clínica com **diferentes salas e diferentes especialistas**.

### O modelo

Hoje (Fase A) a clínica é tratada como um recurso único: a disponibilidade é
`businessHours da clínica − (appointments + calendar_blocks)`. Para multi-profissional,
a disponibilidade passa a ser, para um dado slot, a interseção de três condições:

1. **Profissional livre** — o especialista tem janela de trabalho naquele horário
   (`professionals.workSchedule`) e não tem outro appointment/bloqueio ali.
2. **Sala livre** — existe ao menos uma sala compatível com o procedimento sem
   appointment naquele horário.
3. **Dentro do funcionamento da clínica** — o slot cai no horário comercial.

Um slot é ofertável se as três valem ao mesmo tempo. Reservar consome um profissional
**e** uma sala; double booking passa a ser por (profissional) e por (sala),
independentemente.

### Shape sugerido de `professionals.workSchedule` (jsonb)

```jsonc
{
  "weekly": {
    "1": [{ "start": "08:00", "end": "12:00" }, { "start": "14:00", "end": "18:00" }],
    "2": [{ "start": "08:00", "end": "12:00" }]
    // chave = dia da semana (0=dom ... 6=sáb); ausência = não atende
  },
  "exceptions": [{ "date": "2026-12-24", "closed": true }]
}
```

### Salas

- Tabela `rooms` já existe (`appointments.roomId` referencia). Falta: associar quais
  procedimentos/profissionais usam quais salas, e contar a sala como recurso no overlap.
- Regra inicial simples: nº de slots simultâneos no mesmo horário ≤ nº de salas compatíveis.

### Mudanças necessárias (quando for a hora)

1. `buildBusyEvents` já filtra por `professionalId`; falta a janela do profissional
   (`workSchedule`) substituir o `businessHours` quando há profissional.
2. `listAvailableSlots` recebe `professionalId` e passa a usar a janela do profissional;
   um segundo passo cruza com disponibilidade de sala.
3. `SlotReservationService`: unique por `(clinicId, professionalId, startsAt)` e por
   `(clinicId, roomId, startsAt)` em vez de só `(clinicId, startsAt)`.
4. UI: ligar o **resource view** do @schedule-x (uma coluna por profissional).
5. Settings: CRUD de profissionais (editar `workSchedule`) e de salas.

> Enquanto a Fase C não existir, o modo interno só é correto para clínicas de **um
> profissional / um recurso**. Não vender modo interno para clínica multi-profissional
> antes disso (ou o overlap bloqueia horários indevidamente).

---

## Arquivos críticos

| Arquivo | Papel |
|---------|-------|
| `src/infrastructure/db/schema.ts` | `calendarMode` em `clinics` e `calendar_blocks` |
| `src/application/ports/calendar-gateway.ts` | Port que `InternalCalendarGateway` deve implementar |
| `src/infrastructure/adapters/calendar/google/google-calendar-gateway.ts` | Referência de implementação |
| `src/infrastructure/adapters/calendar/resolve-calendar-gateway.ts` | Resolve o gateway efetivo por clínica |
| `src/core/scheduling/BookingService.ts` | Recebe gateway via DI e revalida conflito no banco/gateway |
| `src/core/scheduling/SlotEngine.ts` | Usa gateway para listar slots |
| `src/app/api/appointments/route.ts` | Endpoint de criação usa BookingService |
| `src/core/scheduling/internal-availability.ts` | Normaliza appointments/bloqueios internos para o SlotEngine |

---

## Verificação de ponta a ponta

1. Clínica sem GCal → IA oferece horários baseados em `businessHours` + banco.
2. Ximendes com `calendarMode = "internal"` e `googleCalendarId` preenchido → usa `InternalCalendarGateway`.
3. Bloqueio criado em `/api/calendar/blocks` no modo interno → remove o horário das ofertas.
4. Conflito de horário no modo interno detectado corretamente (dois pacientes no mesmo slot).
5. Cancelamento/reagendamento no modo interno atualiza o banco e libera/ocupa disponibilidade.
6. Lembrete D-1 disparado para appointments criados via modo interno.
