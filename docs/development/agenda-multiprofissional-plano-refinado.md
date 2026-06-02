# Agenda multi-profissional para clínicas — Plano refinado

Data: 2026-06-02
Base: evolução do documento "Agenda por profissional: view própria com CSS Grid"

---

## 0. O que mudou em relação ao plano original

O plano original estava correto na decisão (construir a view) e bom no diagnóstico
de risco. Este refinamento adiciona as camadas que faltavam para escalar de uma
clínica para várias:

1. **Multi-tenancy** como fundação — hoje o plano não isola dados por clínica.
2. **Garantia de double-booking no banco**, não só na aplicação.
3. **Modelo de dados** ampliado (serviços, bloqueios, salas, sync state, notificações).
4. **Abordagem concreta de renderização** da grade (matemática, sticky, overlap).
5. **Modelo de sincronização Google Calendar** com decisão de "source of truth".
6. **Camada de notificações** desenhada como fila idempotente.
7. **Roadmap re-faseado** para colocar as fundações antes da UI bonita.

---

## 1. Reframe estratégico: build vs buy

Comprar uma licença premium entrega o **frontend** do scheduler (a grade, o drag
and drop, o resize). Não entrega:

- anti-double-booking transacional,
- timezone correto por clínica,
- sincronização bidirecional com Google Calendar,
- regras de disponibilidade por profissional/sala/serviço,
- notificações.

Como essas partes você precisa construir de qualquer jeito, a economia de comprar
é justamente na parte que você faz bem (a view) — não na parte cara. Conclusão:
**construir a view continua sendo a decisão certa**, mas o esforço real está no
backend. Estime a view bem-feita (overlap, sticky, DnD, mobile, acessibilidade)
em algo como 2–4 semanas de trabalho focado para alcançar polimento comparável.
Não trate a view como "só CSS".

---

## 2. Fundação: multi-tenancy

Para escalar para várias clínicas, **toda tabela de domínio precisa de `clinicId`**
(ou `organizationId` → `clinicId` se houver redes com várias unidades). A agenda
é sempre consultada com escopo `clinicId + data + view`.

Princípios:

- `clinicId` em `professionals`, `appointments`, `rooms`, `blocks`,
  `services`, `notifications`, `calendar_sync_state`.
- Toda query do backend filtra por `clinicId` derivado do usuário autenticado,
  **nunca** do corpo da requisição (evita acesso cruzado entre clínicas).
- Se o banco for Postgres, considere Row Level Security como rede de segurança
  além do filtro de aplicação.
- A clínica guarda também o **timezone IANA** (ex.: `America/Sao_Paulo`) e os
  horários de funcionamento padrão.

Fazer isso depois é doloroso: cada índice, constraint e query precisaria ser
reescrito. É barato agora e caro depois.

---

## 3. Modelo de dados ampliado

Mantendo o que você já tem e adicionando o que falta.

### professionals (existe — ampliar)
- `clinicId`, `isActive`
- `color`, `specialtyId`
- `slotDurationMinutes?` (alguns atendem em 30min, outros 50min)
- `googleCalendarId?`
- `defaultRoomId?`

### appointments (existe — ampliar)
- `clinicId`, `professionalId?`, `roomId?`, `serviceId?`, `patientId`
- `startsAt`, `endsAt` (sempre UTC / timestamptz)
- `status` (enum: `scheduled`, `confirmed`, `in_progress`, `done`, `cancelled`, `no_show`)
- `source` (`whatsapp_ai`, `reception`, `patient_portal`, `google_import`)
- `googleEventId?`
- `version` (inteiro, para concorrência otimista — ver seção 10)
- `createdBy`, `createdAt`, `updatedAt`

### services / procedimentos (novo)
- `clinicId`, `name`, `defaultDurationMinutes`, `color?`
- quais especialidades/profissionais podem executar
- Resolve a duração automaticamente ao agendar e dá cor por tipo de atendimento.

### rooms (novo ou ampliar)
- `clinicId`, `name`, `capacity`, `allowedSpecialties?`

### blocks / bloqueios (novo — first-class)
- `clinicId`
- `scope`: `clinic` | `professional` | `room`
- `professionalId?`, `roomId?`
- `startsAt`, `endsAt`, `reason`
- `recurringRule?` (ex.: almoço diário)
- Modelar bloqueio como entidade própria (não como "appointment fake") deixa as
  regras explícitas e a UI mais limpa.

### working_hours (novo — preferir linhas a JSON)
- `professionalId`, `weekday` (0–6), `startMinute`, `endMinute`
- Linhas estruturadas são muito mais fáceis de consultar do que um blob JSON
  `workSchedule` quando a regra vira central. Migre o `workSchedule` atual para cá.

### calendar_sync_state (novo)
- `professionalId` ou `clinicId`, `googleCalendarId`
- `syncToken`, `channelId`, `resourceId`, `channelExpiration`
- Necessário para sync incremental (seção 8).

### notifications / notification_log (novo)
- `clinicId`, `appointmentId`, `channel`, `templateId`, `scheduledFor`
- `status`, `sentAt`, `idempotencyKey`

### audit_log (recomendado)
- quem mudou o quê, quando — útil quando duas recepcionistas operam a mesma agenda.

---

## 4. O motor de conflitos (a parte crítica)

Essa é a peça que decide se o produto é confiável. A regra: **uma única função
autoritativa** de disponibilidade, chamada por **todos** os caminhos que criam ou
movem agendamento (booking pela IA, recepção, drag-and-drop, resize).

### Contrato único

```ts
checkAvailability({
  clinicId,
  professionalId,        // opcional: agendamento "sem profissional"
  roomId,                // opcional
  startsAt, endsAt,
  ignoreAppointmentId,   // ao mover/redimensionar, ignora o próprio
}): { ok: true }
 | { ok: false, reason:
     'professional_busy' | 'room_busy' | 'outside_working_hours' |
     'blocked_clinic' | 'blocked_professional' | 'blocked_room' }
```

`BookingService.book` e `PATCH /api/appointments/[id]` chamam a **mesma** função.
Nunca duplique a regra em dois lugares — é assim que aparece divergência entre o
que a IA aceita e o que a recepção aceita.

### Garantia no banco (não confie só na aplicação)

A checagem na aplicação dá mensagens de erro bonitas, mas **não protege contra
corrida** (duas requisições simultâneas passam pela checagem antes de qualquer
uma gravar). A proteção real precisa estar no banco.

**Se for Postgres** (recomendado): use exclusion constraint com `tstzrange`.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
  ADD CONSTRAINT no_double_book_professional
  EXCLUDE USING gist (
    professional_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled' AND professional_id IS NOT NULL);

-- análogo para sala:
ALTER TABLE appointments
  ADD CONSTRAINT no_double_book_room
  EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled' AND room_id IS NOT NULL);
```

Com isso, double booking vira **impossível** independentemente de bug ou corrida.
A aplicação trata a violação da constraint e devolve `slot_taken` amigável.

**Se for MySQL/PlanetScale/SQLite** (sem exclusion constraint): use transação
serializável com `SELECT ... FOR UPDATE` sobre as linhas que se sobrepõem no
intervalo, ou advisory lock por `(professionalId, dia)`. Mais frágil — se houver
liberdade de escolha de banco, **prefira Postgres por causa disso**.

### Regra: profissional vs sala vs clínica

- Dois profissionais diferentes **podem** ocupar o mesmo horário.
- O mesmo profissional **não pode** se sobrepor.
- A mesma sala **não pode** ter dois atendimentos simultâneos.
- Bloqueio com `scope = clinic` invalida o horário para todos.
- "Sem profissional" não dispara conflito de profissional (vai para a coluna
  própria), mas ainda respeita sala e bloqueio de clínica.

---

## 5. Timezone

Regras inegociáveis:

- Armazene **tudo em UTC** (`timestamptz`).
- Cada clínica tem um **timezone IANA**. Toda renderização converte UTC → tz da
  clínica.
- Horários de trabalho e bloqueios são definidos em **wall-clock local** da clínica.
- "Minutos do dia" para posicionar eventos são calculados no **horário local**,
  não no servidor.
- **Nunca** faça aritmética manual de offset. Use `Temporal` (se disponível no seu
  runtime) ou `Luxon`/`date-fns-tz`.
- Não assuma "Brasil não tem horário de verão". O Brasil aboliu o DST em 2019,
  mas multi-clínica pode incluir fusos com DST. Trate via biblioteca, sem
  hardcode.

Caso de teste obrigatório: um agendamento marcado às 08:00 locais aparece às 08:00
na grade **independente do timezone do servidor**, e atravessa corretamente uma
fronteira de DST.

---

## 6. A view: abordagem concreta de renderização

Apesar do título "CSS Grid", o padrão usado por scheduler reais (inclusive
FullCalendar) é **híbrido**: CSS Grid para o esqueleto, posicionamento absoluto
para os eventos. Recomendo o mesmo.

### Esqueleto (CSS Grid)

```
grid-template-columns: [eixo de horas] auto repeat(N, minmax(180px, 1fr));
```

- **1 container de scroll** envolvendo tudo (header + eixo + corpo).
- Linha de cabeçalho dos profissionais: `position: sticky; top: 0`.
- Coluna do eixo de horas: `position: sticky; left: 0`.
- Célula de canto (cruzamento): `sticky; top:0; left:0` com `z-index` maior.
- `repeat(N, ...)` permite scroll horizontal natural com muitos profissionais.

### Matemática de posição (estável)

Defina constantes:

```ts
const DAY_START_MIN = 7 * 60;   // 07:00
const DAY_END_MIN   = 20 * 60;  // 20:00
const PX_PER_MIN    = 1.4;      // ajuste de densidade
const SNAP_MIN      = 15;       // granularidade de slot e de drag
```

Para cada evento (em horário **local da clínica**):

```ts
const top    = (startMin - DAY_START_MIN) * PX_PER_MIN;
const height = (endMin   - startMin)      * PX_PER_MIN;
```

Snap (em renderização e em drag) elimina drift de sub-pixel e faz o arraste
parecer "encaixar".

### Overlap dentro da mesma coluna (column packing)

Eventos do mesmo profissional que se sobrepõem dividem a largura. Algoritmo
clássico de interval graph:

```
1. ordene eventos por startMin.
2. agrupe em "clusters" de eventos mutuamente sobrepostos.
3. dentro de cada cluster, atribua cada evento à primeira "lane" (coluna)
   livre — greedy.
4. width = larguraDaColuna / numeroDeLanesNoCluster.
5. left  = lane * width.
```

Teste isso com unit tests puros: dado um conjunto de intervalos, espere lanes e
larguras determinísticas.

### Indicador de "agora"

Linha horizontal em `(nowMin - DAY_START_MIN) * PX_PER_MIN`, atualizada a cada
minuto, exibida **só** quando a data é hoje e está dentro do range.

### Mobile

- Desktop/recepção: várias colunas com scroll horizontal.
- Mobile: **uma coluna por vez** com seletor de profissional no topo, ou modo
  "lista por profissional". Forçar N colunas no celular deixa a grade inútil —
  troque o layout, não só reduza.

### Acessibilidade (não deixar para depois)

- Status não pode depender **só de cor** (daltonismo): combine cor + borda/ícone.
- Navegação por teclado entre slots, ARIA roles na grade.
- Contraste mínimo nas cores dos profissionais.
- Estilo de impressão dedicado, se a recepção imprime a agenda do dia.

---

## 7. Drag and drop

- Use **Pointer Events** (mouse + touch) ou `@dnd-kit`. Evite HTML5 drag-and-drop
  nativo: ruim no mobile e sem controle de snap.
- **Atualização otimista**: mova o evento no estado local imediatamente, dispare
  o `PATCH`, e em erro `slot_taken` faça rollback visual + toast.
- **Preview de slot**: ghost durante o arraste, com snap ao slot e estilo
  inválido (vermelho) sobre região bloqueada/ocupada.
- Mover entre colunas = trocar `professionalId` → o `PATCH` revalida via motor de
  conflito.
- Resize = alterar `endsAt` (ou `startsAt`) → mesma revalidação.

---

## 8. Sincronização com Google Calendar (a parte mais arriscada)

### Decisão de arquitetura: calendário por profissional

Recomendo **um calendário Google por profissional** (cada um com seu
`googleCalendarId`), com a recepção vendo tudo combinado no seu app. Um único
calendário da clínica vira bagunça com muitos profissionais e dificulta permissões.

### Decisão de "source of truth"

Defina explicitamente:

- Eventos **criados no seu app** → seu app é a fonte da verdade; você empurra
  para o Google.
- Eventos **criados no Google** → trate como **bloqueio externo** (reserva o
  slot, aparece na grade como indisponível, mas não é um agendamento de paciente
  editável). Isso evita o pesadelo de merge bidirecional completo.

### Saída (outbound)

- Em create/update/cancel, empurre para o Google e guarde `googleEventId`.
- Idempotência via `googleEventId` para não duplicar em retries.

### Entrada (inbound) — incremental

- Use **push notifications** (watch channels) + sync incremental com `syncToken`.
- Guarde `syncToken`/`channelId`/`resourceId` em `calendar_sync_state`.
- No webhook, rode sync incremental e faça upsert/cancel local.
- Trate **HTTP 410 Gone** (token expirado) → resync completo.

### Faseamento sugerido para reduzir risco

Não comece pelo sync bidirecional completo. Comece com:

1. **Outbound only** (seu app empurra para o Google).
2. **Eventos externos como bloqueios read-only** via poll periódico ou watch.
3. Só depois, se necessário, edição bidirecional real.

---

## 9. Notificações

Desenhe como **fila idempotente**, não como envio inline.

- Armazenamento: tabela de jobs + worker, ou Redis/BullMQ, ou cron serverless.
- Gatilhos: confirmação ao agendar, lembrete 24h e 2h antes, cancelamento,
  reagendamento, no-show.
- **Idempotency key** por (appointmentId + tipo + janela) para não enviar
  lembrete duplicado.
- Canais: WhatsApp (você já tem automação), e-mail, SMS — com fallback.
- Templates com variáveis (nome, profissional, horário local, sala).
- Respeitar quiet hours no **timezone da clínica**.
- Logar todo envio (auditoria + dedupe).

Ponto sutil: ao **reagendar**, cancele o lembrete antigo e reenfileire o novo.
Lembrete enviado com horário velho é um bug clássico e gera no-show.

---

## 10. API — endpoints e contratos

### Endpoint único da agenda (evitar waterfall)

```
GET /api/agenda?clinicId&date&view=day-by-professional
→ {
    professionals: [{ id, name, color, workingHours[], googleCalendarId? }],
    appointments:  [{ id, professionalId, roomId, startsAt, endsAt, status,
                      patientName, patientPhoneMasked, serviceName, version }],
    blocks:        [{ scope, professionalId?, roomId?, startsAt, endsAt, reason }]
  }
```

Tudo num payload só — evita N+1 e várias idas ao servidor para montar uma tela.

### Criar (POST)

- Aceite header **`Idempotency-Key`** para evitar duplicação por duplo clique /
  retry da IA.
- `BookingService.book` deve salvar `professionalId` no appointment criado.

### Mover/redimensionar (PATCH)

- Aceita `{ professionalId?, roomId?, startsAt?, endsAt?, version }`.
- Roda o motor de conflito.
- **Concorrência otimista**: rejeita se `version` enviado for diferente do atual
  (duas recepcionistas editando o mesmo evento). Devolve `409 stale`.
- Erro estruturado: `{ error: 'slot_taken', conflictWith: { id, startsAt, endsAt } }`.

---

## 11. Testes

Mantenha o que você já tem:

```bash
npm run verify
npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
```

Novos testes essenciais:

- **Constraint do banco** rejeita inserts concorrentes (teste de integração com
  duas transações em paralelo) — não basta testar a checagem da aplicação.
- Dois profissionais diferentes no mesmo horário: **permitido**.
- Mesmo profissional, mesmo horário: **bloqueado**.
- Mesma sala, mesmo horário: **bloqueado**.
- Mover entre profissionais revalida conflito.
- Mover para horário ocupado retorna `slot_taken`.
- Agendamento sem profissional vai para a coluna "Sem profissional".
- Clique em coluna de profissional preenche `professionalId` no modal.
- **Timezone**: 08:00 local renderiza às 08:00 com qualquer tz de servidor; caso
  de fronteira de DST.
- **Overlap**: dado um conjunto de intervalos, lanes/larguras determinísticas.
- **minutos↔pixels**: round-trip e snapping.
- **Concorrência otimista**: PATCH com `version` velho é rejeitado.
- **Bloqueio**: agendar dentro de bloqueio de clínica/profissional/sala falha
  com a razão correta.

---

## 12. Roadmap re-faseado

A reorganização principal: **fundações de backend antes da UI bonita**, porque
construir a view sobre um backend não-tenant-aware e sem garantia de conflito gera
retrabalho.

### Fase 0 — Fundações (antes de qualquer pixel novo)
1. `clinicId` em todas as tabelas de domínio + filtro por usuário autenticado.
2. Timezone por clínica e armazenamento UTC consistente.
3. Motor de conflito único (`checkAvailability`).
4. Constraint de double-booking no banco (profissional + sala).
5. `version` em appointments para concorrência otimista.

### Fase 1 — View "Dia por profissional" (read + criar)
1. Endpoint único da agenda.
2. Colunas por profissional ativo + coluna "Sem profissional".
3. Eixo de horas configurável (inicial 07:00–20:00), sticky header/eixo.
4. Posicionamento por `startsAt`/`endsAt` + overlap packing.
5. Eventos coloridos por profissional/status (cor + borda/ícone).
6. Clique em slot livre → `AppointmentModal` com data/hora/profissional.
7. Clique em evento → `AppointmentDrawer`.
8. Indicador de "agora".
9. Manter Schedule-X como visualização semanal/mensal alternativa.

### Fase 2 — Interação (mover)
1. Drag and drop na mesma coluna (mudar horário).
2. Drag and drop entre colunas (trocar profissional).
3. Preview de slot inválido.
4. Tratamento de `slot_taken` + rollback otimista.
5. Resize de duração.

### Fase 3 — Operação de clínica
1. Filtros por profissional/status/serviço.
2. Horários de trabalho por profissional (`working_hours`).
3. Bloqueios por escopo (clínica/profissional/sala).
4. Notificações (confirmação + lembretes idempotentes).
5. Mobile dedicado (uma coluna + seletor).
6. Impressão/exportação para recepção.

### Fase 4 — Google Calendar
1. Outbound (push do app para o Google), calendário por profissional.
2. Eventos externos como bloqueios read-only.
3. Sync incremental com `syncToken` + watch channels.
4. (Opcional) edição bidirecional.

### Fase 5 — Escala e extras
1. Salas com regras por especialidade.
2. Recorrência de agendamento.
3. Lista de espera (waitlist).
4. Auditoria/relatórios.

---

## 13. Decisões em aberto — com recomendação

Respondendo às perguntas do plano original com posição, não só dúvida:

- **Google: calendário único ou por profissional?** → **Por profissional.** Mais
  limpo, melhor permissão, evita merge caótico.
- **Recepção: dia por profissional ou semana por profissional?** → Comece com
  **dia por profissional** (caso de uso mais quente da recepção); semana por
  profissional vira filtro/visão posterior.
- **Atendimento simultâneo em salas diferentes?** → Sim, por isso sala é dimensão
  separada de profissional, com constraint própria.
- **Bloqueio é da clínica, profissional ou sala?** → **Os três** — modele `scope`
  explícito, não escolha um só.
- **IA escolhe profissional automaticamente ou só oferece horários livres?** →
  Ofereça as **duas opções**: por padrão, ofereça horários livres de qualquer
  profissional; permita preferência de profissional quando o paciente pedir.
- **Mobile: operação completa ou consulta?** → **Consulta rápida + ações simples**
  (ver, confirmar, cancelar). Drag-and-drop completo no mobile tem ROI baixo no
  começo.

A única decisão que muda a arquitetura de forma profunda e que vale confirmar
cedo é **qual banco de dados** você usa: com Postgres você ganha a exclusion
constraint (seção 4) e o anti-double-booking fica trivialmente correto; sem ele,
a concorrência exige transações serializáveis ou locks, com mais risco.

---

## 14. Comentário do Codex (GPT-5) — opinião técnica

Análise feita por **Codex**, modelo baseado em **GPT-5**, em 2026-06-02.

Minha recomendação é que o **calendário próprio do SystemOps seja a fonte da
verdade** do produto, e que o Google Calendar seja tratado como integração
opcional para clínicas que já usam Google e teriam resistência em migrar no
primeiro momento.

Isso muda a prioridade arquitetural:

1. `appointments`, `blocks`, `working_hours`, `professionals`, `rooms` e
   `treatments` devem sustentar toda a disponibilidade dentro do banco.
2. `checkAvailability` deve ser determinístico e depender primeiro do estado
   interno do SystemOps, não da resposta em tempo real do Google.
3. As constraints de double-booking no Postgres devem ser a garantia final para
   profissional e sala.
4. Bloqueios precisam ser first-class no banco, com `scope = clinic |
   professional | room`, em vez de dependerem de eventos com prefixo no Google.
5. Google Calendar deve virar um adaptador de sincronização:
   - outbound: espelhar agendamentos criados no SystemOps;
   - inbound: tratar eventos criados no Google como bloqueios externos read-only;
   - falhas de sync viram jobs pendentes, não falha imediata do agendamento.
6. A agenda precisa funcionar 100% sem Google Calendar. Isso reduz latência,
   rate limit, complexidade de permissão, dependência externa e risco operacional
   quando o objetivo é atender 1000+ clínicas.

Eu não removeria o Google Calendar com um corte brusco. O caminho mais seguro é
**desacoplar**: primeiro mover disponibilidade, bloqueios e conflitos para o core
interno; depois deixar Google como integração ativável por clínica ou por
profissional. Assim o produto ganha controle e escala, mas mantém uma ponte de
adoção para clínicas que já operam no Google.
