# Sources of Truth — Mapa de Fontes da Verdade

Auditado em 2026-06-04. Atualizar sempre que um novo tipo de dado for introduzido.

## Regra Central

**Se você precisar mudar uma regra em mais de um lugar, a arquitetura está errada.**

Cada tipo de informação tem um único dono. Qualquer duplicação — especialmente entre código e prompt de LLM — é risco de divergência silenciosa.

---

## Mapa de Donos

### 1. Conteúdo Editorial (tom, objeções, política comercial, playbook)

**Dono:** tabela `playbook_versions`  
**Porta de acesso:** `resolveActiveEditorialConfig(clinicId)` em `src/application/config/editorial-config.ts`

O Orchestrator injeta o conteúdo editorial no prompt via `ComposerInput.clinic`. O prompt LLM **nunca** declara política comercial, tom ou objeções como texto fixo — ele os recebe como variáveis em runtime.

### 2. Configuração Operacional da Clínica

**Dono:** tabela `clinics` — campos lidos ativamente em runtime:

| Campo | Lido Por | Propósito |
|-------|----------|-----------|
| `timezone` | `ClinicTimezone` | Toda conversão de horário |
| `businessHours` | `parseBusinessHours()`, `SlotEngine` | Validação de slots disponíveis |
| `defaultAppointmentDurationMinutes` | `ConversationOrchestrator` | Duração de consulta quando treatment não especifica |
| `postAppointmentBufferMinutes` | `SlotEngine` | Buffer entre consultas |
| `takeoverTtlHours` | `ConversationOrchestrator` | Tempo até IA retomar após pausa humana |
| `conversationExperience` | `ConversationOrchestrator`, `ResponseComposer` | Modo da jornada: `menu_first` ou `concierge` |
| `greetingMessage` | `buildMenuBody()` | Saudação inicial no menu |
| `menuItems` | `resolveMenuSelection()` | Itens do menu conversacional |
| `receptionistPhone` | `ConversationOrchestrator` | Notificações de urgência/needs_human |
| `autoReplyEnabled` | webhook `zapi/route.ts` | Gate de resposta automática |
| `calendarMode` | `resolveCalendarGateway()` | Fonte de verdade da disponibilidade: `internal` ou `google_calendar` |
| `googleCalendarId` | `GoogleCalendarGateway` | Conector opcional para clínicas em modo `google_calendar` |
| `zapiToken`, `metaAccessToken` etc. | `sendTextMessage()` | Credenciais de canal |
| `specialty` | `ResponseComposer` | Fallback quando editorial não especifica |
| `address` | `ConversationOrchestrator` | Resposta de localização |

### 2.1. Agenda Interna

**Dono de agendamentos:** tabela `appointments`

**Dono de bloqueios internos:** tabela `calendar_blocks`

**Porta de acesso:** `resolveCalendarGateway()` em `src/infrastructure/adapters/calendar/resolve-calendar-gateway.ts`

No modo `internal`, a disponibilidade é calculada pelo `InternalCalendarGateway`
com `SlotEngine`, `appointments` ativos e `calendar_blocks`. Google Calendar não
decide disponibilidade nesse modo.

No modo `google_calendar`, Google Calendar continua como fonte opt-in/legado para
disponibilidade e eventos externos. O banco mantém os `appointments` do produto.

**Campos no banco que NÃO são lidos em runtime (dead code de schema):**

| Campo | Status |
|-------|--------|
| `plan` | Armazenado — feature gates por plano não implementados |
| `monthlyRevenueBrl` | Armazenado — billing via `/owner/financeiro`, mas este campo nunca é lido |
| `billingStartedAt` | Armazenado — nunca lido |
| `isTest` | Armazenado — sandbox não implementado |
| `slug` | Armazenado — nunca lido em runtime |
| `calendarChannelId`, `calendarSyncToken` | Infraestrutura futura — não implementada |

### 3. Comportamento Conversacional Universal

**Dono:** strings de prompt em `src/core/intelligence/` (ResponseComposer, IntentClassifier)

Regras que **não variam por clínica** (estrutura da resposta, anti-repetição, formato de horários, etc.) ficam **somente** no prompt. Nunca criar campo no banco para guardar algo que é igual para todas as clínicas.

### 4. Constantes Operacionais Globais

**Dono:** constantes no código — com fallback explícito se puderem variar por clínica no futuro.

| Constante | Valor | Arquivo | Configurável por clínica? |
|-----------|-------|---------|--------------------------|
| `SLOTS_LOOKAHEAD_DAYS` | 14 | `ConversationOrchestrator.ts` | ❌ P1: mover para `clinics.slotsLookaheadDays` |
| `RATE_LIMIT_MESSAGES_PER_HOUR` | 20 | `ConversationOrchestrator.ts` | ❌ P1: mover para `clinics.rateLimitMessagesPerHour` |
| `CONVERSATION_RESTART_HOURS` | 4 | `ConversationOrchestrator.ts` | ❌ P2: mover para `clinics.conversationRestartHours` |
| `UNCLEAR_THRESHOLD` | 3 | `ConversationOrchestrator.ts` | ❌ P2: mover para `clinics.unclearThreshold` |
| `MAX_SLOTS_TO_OFFER` | 5 | `ConversationOrchestrator.ts` | ❌ P2: mover se houver reclamação |
| `SLOT_OFFER_TTL_MINUTES` | 15 | `ConversationStateMachine.ts` | ❌ Baixa prioridade |
| `RESERVATION_TTL_MINUTES` | 15 | `SlotReservationService.ts` | ❌ Deve ser >= SLOT_OFFER_TTL |
| `MIN_ADVANCE_HOURS` | 2 | `ConversationOrchestrator.ts` | ❌ Baixa prioridade |

**Invariante obrigatória:** `RESERVATION_TTL_MINUTES` ≥ `SLOT_OFFER_TTL_MINUTES`. O lead pode tentar confirmar enquanto a oferta ainda é válida — o lock no banco deve existir durante toda essa janela.

### 5. Lógica de Tempo e Timezone

**Dono:** `src/core/scheduling/ClinicTimezone.ts`

Toda operação que envolve horário local da clínica passa por `ClinicTimezone`. Funções exportadas:

- `toLocalParts(date)` → converte UTC para partes locais (hora, minuto, dia etc.)
- `getTimeGreeting(hour)` → "Bom dia" / "Boa tarde" / "Boa noite" — **única fonte desta regra**
- `formatNowForPrompt()` → string de data/hora para injetar no prompt do LLM
- `parseBusinessHours(str)` → parse da string de horário comercial

**Nunca:**
- Usar `new Date().getHours()` diretamente (ignora timezone da clínica)
- Hardcodar offset UTC (`-3`, `UTC-3`) — viola clínicas fora de SP
- Repetir a lógica de saudação temporal no texto do prompt (use `getTimeGreeting()` e injete o resultado)

---

## Invariantes de Janela de Contexto LLM

`IntentClassifier` e `ResponseComposer` devem usar o **mesmo tamanho de janela** de histórico recente. Atualmente: `.slice(-8)`.

Se precisar mudar esse valor, mude em ambos os arquivos simultaneamente:
- `src/core/intelligence/IntentClassifier.ts`
- `src/core/intelligence/ResponseComposer.ts`

---

## Checklist: Antes de Adicionar uma Nova Regra ou Constante

1. **Essa informação varia por clínica?**
   - Sim → `clinics.*` (com migration + fallback no código)
   - Não → constante no código ou string no prompt (nunca nos dois)

2. **Essa regra já existe em outro lugar?**
   - Buscar em `ClinicTimezone.ts`, `ConversationOrchestrator.ts`, `ResponseComposer.ts`, `IntentClassifier.ts` antes de criar algo novo

3. **Essa regra está no prompt E no código?**
   - Errado. O prompt recebe o valor como variável injetada em runtime — não o redeclara

4. **Essa constante precisa ser testada?**
   - Se mudar quebra comportamento observável (booking, slots, takeover) → sim, escreva o teste
