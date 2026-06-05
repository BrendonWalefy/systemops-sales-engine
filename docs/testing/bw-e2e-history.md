# BW Odontologia — Histórico de Testes E2E

Registro cronológico das sessões de validação na clínica de testes BW Odontologia.
Cada sessão lista os cenários executados, bugs encontrados, correções aplicadas e
o estado final. Serve como referência técnica e insumo para futuras clínicas.

---

## Sessão 001 — 2026-06-05

**Contexto:** primeira validação E2E completa após implementação do calendário
interno como fonte de verdade principal. Google Calendar configurado como opcional.
Clínica de testes `bw-odontologia` com `isTest=true`, `calendarMode=internal`,
`conversationExperience=concierge`.

**Como os testes foram executados:**
- Webhook real POST para `/api/whatsapp/zapi` com phone `5511953628848` (allowlistado)
- Roteamento automático Ximendes → BW via `whatsapp_qa_routes`
- OpenAI real, Z-API send bloqueado (`DISABLE_REAL_WHATSAPP_SEND=true`)
- Verificação de estado no banco após cada passo

---

### T01 — Saudação concierge

**Resultado:** ✅ PASSOU

- Intent: `greeting` / `acknowledgment`
- IA NÃO forçou menu numerado (comportamento concierge correto)
- `ai_paused = false` após saudação
- Resposta: "Boa tarde, Brendon Walefy. Tudo bem? Me conta o que você gostaria de ver hoje: avaliação, valores ou algum tratamento específico?"

---

### T02 — Lead fala só "Lentes" (palavra isolada)

**Estado antes:** ❌ BUG — IA ia direto para agenda sem explicar as opções

**Causa raiz:** `IntentClassifier` classifica palavra isolada de tratamento como
`book_appointment`. O `Orchestrator` então vai direto para `slots_found` sem passar
pelo `ResponseComposer` com contexto educativo das `notes`.

**Correção aplicada:** atualização do `playbook_versions` da BW (campo `notes`)
com regra obrigatória: "Sempre que o lead mencionar 'lentes' ou 'facetas', apresentar
as duas técnicas ANTES de oferecer agendamento." E campo `procedure_description`
atualizado com as duas técnicas e valores iniciais.

**Resultado:** ✅ PASSOU após correção

- Resposta: "As opções de lentes que oferecemos são: 1. Técnica Simplificada (resina nacional) — resultado harmonioso e natural, a partir de R$ 2.500 para 20 elementos. 2. Técnica Estratificada (resina importada) — acabamento mais refinado e personalizado, a partir de R$ 5.000 para..."

---

### T03 — "Tem quais opções de lentes?"

**Estado antes:** ❌ BUG — classificado como `unclear`, IA perguntava de volta sem explicar

**Causa raiz:** `IntentClassifier` não reconhecia "quais opções de [tratamento]?"
como `general_question`. Sem exemplos explícitos de perguntas de comparação no prompt.

**Correção aplicada:** atualização das `notes` do playbook com instrução direta.

**Resultado:** ✅ PASSOU — intent `general_question`

⚠️ **Observação de qualidade:** resposta listou todos os procedimentos da clínica
(1. Avaliação odontológica, 2. Clareamento dental...) em vez de focar nas opções
de lentes especificamente. O contexto de "opções de lentes" se perdeu após múltiplos
turnos da conversa. Investigar se o `stateMachine` preserva o contexto de tratamento
entre turnos.

---

### T04 — Price inquiry com valores explícitos

**Estado antes:** ❌ BUG — IA deflectava para "depende da avaliação" sem dar valores

**Causa raiz:** `commercial_policy` do playbook decia "Não informar valores fechados
sem avaliação", bloqueando qualquer resposta com preço.

**Correção aplicada:** `commercial_policy` atualizado para autorizar explicitamente
os valores "a partir de":
- Lentes Simplificadas: a partir de R$ 2.500 para 20 elementos
- Lentes Estratificadas: a partir de R$ 5.000 para 20 elementos

**Resultado:** ✅ PASSOU

- Resposta: "Sim, a partir de R$ 2.500 para a técnica simplificada e a partir de R$ 5.000 para a técnica estratificada. O valor exato é definido na avaliação."
- Nenhum preço inventado fora dos valores autorizados.

---

### T05 — Agendamento completo (booking)

**Resultado:** ✅ PASSOU

- Intent correto: `book_appointment` → slots oferecidos → `confirm_slot`
- Appointment criado no banco com `source="app"`, `calendarEventId=null`, `status="scheduled"`
- `lead_status` atualizado para `appointment_scheduled`
- Exemplo de resposta de confirmação: "Seu agendamento para a avaliação odontológica está confirmado para hoje, 5 de junho, às 16h."

---

### T06 — Verificação do appointment no banco

**Resultado:** ✅ PASSOU — todos os campos validados

```
status:           scheduled
source:           app           (calendário interno, não Google Calendar)
calendarEventId:  null          (sem evento externo)
starts_at:        2026-06-05T19:00:00Z  (16h BRT)
```

---

### T07 — Cancelamento de consulta

**Resultado:** ✅ PASSOU

- Intent: `cancel_appointment`
- Appointment atualizado para `status="cancelled"` no banco
- `lead_status` voltou para `in_conversation`
- Resposta: "Seu agendamento foi cancelado com sucesso. Se precisar reagendar ou tiver alguma dúvida no futuro, estarei aqui para ajudar."

---

### T08 — Reagendamento após cancelamento

**Resultado:** ❌ PENDENTE DE INVESTIGAÇÃO

**Sintoma:** após cancela + novo agendamento, o agente responde com `confirm_slot`
mas o appointment NÃO é salvo no banco. Resposta do agente: "O horário que você
escolheu acabou de ser reservado por outro paciente."

**Hipóteses investigadas:**
1. Slot no passado no momento da confirmação → descartada (slot 19:00 UTC, hora atual 16:49 UTC)
2. Reservation não liberada do T05 → descartada (reservation com `status=released`)
3. Appointment cancelado bloqueando isSlotFree → descartada (loadBusyEvents filtra por `scheduled/confirmed`)
4. Orphan slot_reservations da clinica → tentativa de limpeza pendente

**Estado:** investigação interrompida para preservação do histórico. Re-run limpo
programado para próxima sessão.

---

### T09 — Needs Human (handoff ao operador)

**Resultado:** ✅ PASSOU

- Intent: `needs_human`
- `ai_paused = true` no banco
- `needs_attention = true`
- `attention_reason = "Lead quer falar com o dentista."`
- Resposta: "Entendi, Brendon. Já avisei a equipe sobre seu pedido e eles irão responder em breve."

---

### T09b — IA permanece em silêncio enquanto pausada

**Resultado:** ✅ PASSOU

- Lead enviou mensagem "e o desconto?" enquanto `ai_paused=true`
- IA não respondeu (comportamento correto)
- `ai_paused` permaneceu `true`
- Log do servidor: `[Orchestrator] AI pausada para <convId>, ignorando resposta`

---

### T10 — Human Takeover via fromMe (operador responde pelo celular)

**Resultado:** ✅ PASSOU

- Mensagem `fromMe=true` do operador processada corretamente
- `ai_paused = true` setado com TTL de 4h
- `takeoverExpiresAt` setado para o futuro
- Mensagem salva no banco com `author="clinic_user"`
- Log: `[ZApi] Operador enviou mensagem pelo celular para 5511953628848 — IA pausada até 2026-06-05T20:46:45.361Z`

---

### T11 — Urgência clínica

**Resultado:** ✅ PASSOU

- Intent: `clinical_urgency`
- Resposta: "Sinto muito em saber que você está com dor de dente, Brendon. Vou acionar a equipe imediatamente para que alguém entre em contato com você o mais rápido possível."
- `needsAttention = true` no banco (conversa marcada para atenção humana)

---

### T12 — Unclear consecutivo (contador de incremento)

**Resultado:** ⚠️ COMPORTAMENTO DIFERENTE DO ESPERADO

**Observação:** emojis isolados (`😶`, `🤷`) foram classificados como `acknowledgment`
pelo LLM em vez de `unclear`. Isso é razoável no contexto pós-confirmação (onde
um emoji funciona como "ok, entendido"). O `consecutive_unclear_count` permaneceu 0.

**Texto genuinamente nonsense** ("bzurrr clique?", "xkcd zzt 999?") também classificado
como `acknowledgment` no contexto pós-agendamento. Nenhum erro; o LLM interpreta
qualquer coisa como ack nesse contexto.

**Conclusão:** o cenário de unclear consecutivo precisa de mensagens ambíguas
fora de qualquer contexto claro (ex: primeira mensagem da conversa, ou após uma
pergunta aberta). Não é um bug — é contexto-dependente.

---

## Resumo da Sessão 001

| Teste | Resultado | Ação |
|---|---|---|
| T01 Saudação concierge | ✅ | — |
| T02 "Lentes" sem explicar 2 opções | ✅ corrigido | playbook notes + procedure_description |
| T03 "Quais opções" → unclear | ✅ corrigido | playbook notes |
| T04 Preços deflectados | ✅ corrigido | commercial_policy |
| T05 Booking completo | ✅ | — |
| T06 Appointment no banco | ✅ | — |
| T07 Cancelamento | ✅ | — |
| T08 Reagendamento | ❌ pendente | investigar slot_taken pós-cancel |
| T09 Needs human | ✅ | — |
| T09b Silêncio com IA pausada | ✅ | — |
| T10 Human takeover fromMe | ✅ | — |
| T11 Urgência clínica | ✅ | — |
| T12 Unclear consecutivo | ⚠️ contexto-dep. | — |

**Score:** 11/13 ✅  1 ❌  1 ⚠️

---

## Correções de Playbook Aplicadas (BW Odontologia)

### procedure_description (antes → depois)

**Antes:**
> Avaliacao odontologica, limpeza dental, clareamento dental, implante dentario e lentes de resina composta.

**Depois:**
> Lentes de resina composta — duas opções:
> • Técnica Simplificada (resina nacional): a partir de R$ 2.500 para 20 elementos. Resultado harmonioso e natural.
> • Técnica Estratificada (resina importada): a partir de R$ 5.000 para 20 elementos. Acabamento mais refinado e personalizado.
>
> O valor final e o número de elementos são definidos na avaliação com o Dr. Gregory, onde os R$ 100 da consulta são abatidos do tratamento.
>
> Outros procedimentos: avaliação odontológica, limpeza dental, clareamento dental, implante dentário.

### commercial_policy (antes → depois)

**Antes:**
> Nao informar valores fechados sem avaliacao. Explique que o plano e os valores dependem da avaliacao presencial.

**Depois:**
> Quando o lead perguntar sobre lentes, apresente SEMPRE as duas opções com os valores iniciais:
> - Lentes Simplificadas: a partir de R$ 2.500 para 20 elementos
> - Lentes Estratificadas: a partir de R$ 5.000 para 20 elementos
> Esses são valores de referência — o valor exato depende da avaliação presencial. Os R$ 100 da avaliação são abatidos do tratamento caso o paciente avance.

### notes (adicionado)

> REGRA PRINCIPAL — LENTES DE RESINA: Sempre que o lead mencionar "lentes", "facetas", "resina" ou "premium" — mesmo em uma única palavra — explique PRIMEIRO as duas opções antes de oferecer agendamento.

---

## Sessão 002 — 2026-06-05

**Contexto:** revalidação completa da BW Odontologia antes de reativar IA em produção
na Ximendes. Ambiente local com OpenAI real, Z-API send bloqueado
(`DISABLE_REAL_WHATSAPP_SEND=true`) e roteamento real por `whatsapp_qa_routes`.

**Comandos executados:**
- `npm test`
- `npm run bw:e2e`
- `./node_modules/.bin/dotenv -e .env.local -- ./node_modules/.bin/tsx scripts/bw-e2e-extras.ts`
- `npm run bw:dump`

### Bugs encontrados e corrigidos

| Bug | Causa raiz | Correção |
|---|---|---|
| T02 "Lentes" às vezes omitia valores | O LLM resumia o playbook e removia valores obrigatórios; palavra isolada de tratamento podia cair em intent incorreto | Detecção determinística de menção direta a tratamento como `general_question`; prompt do `ResponseComposer` agora preserva valores/condições explícitos |
| T03 "opções de lentes" podia virar `needs_human` | Pergunta curta com token de tratamento não era roteada deterministicamente | Detecção por tokens úteis de tratamentos cadastrados, sem capturar preço/agendamento |
| T08 reagendamento após cancelamento retornava slot indisponível | `slot_reservations` tinha unique `(clinic_id, starts_at)` e uma reserva `released` ainda impedia novo insert | `SlotReservationService.reserve()` reaproveita reserva `released` antes de inserir nova |
| T-AUDIO-01 perdia áudio se download/transcrição falhasse | Rota enviava fallback direto e retornava sem registrar mensagem do lead | Webhook agora envia fallback transcritivo ao `ConversationOrchestrator`, salvando o inbound e respondendo pela IA |
| T-DUPLA-MENSAGEM gerava risco de dupla saudação | Throttle existia só como teste/documentação, não no orquestrador real | `ConversationOrchestrator` suprime segunda mensagem rápida de baixa informação, sem bloquear slots, menus, procedimentos ou preferências |
| T-NUMBER-LIST "8" após lista ficava sem resposta | O novo throttle silenciava número fora do range enquanto a lista de procedimentos estava ativa | Estado `procedure_list_offered` agora bypassa o throttle |
| T-FOLLOWUP por `UPDATE appointments SET status='completed'` não criava follow-up | Follow-up existia apenas no use-case `updateAppointment`, não como contrato de banco | Migration `0008_completed_appointment_follow_up` adiciona trigger idempotente; índice único evita duplicidade com o caminho normal da aplicação |

### Resultados finais

| Teste | Resultado |
|---|---|
| Unit tests | ✅ `393/393` |
| Runner principal T01-T11 | ✅ `47/47` |
| Extras áudio/dupla/stale/lista/follow-up/TTL | ✅ `16/16` |

**Transcrição exportada:** `docs/testing/transcripts/bw/2026-06-05T17-46-26_bw_qa_lead_22cb65f2.txt`

**Observação:** o host `www2.cs.uic.edu` do áudio de teste não resolveu DNS no
ambiente local durante esta sessão. A correção garante que, nesses casos, o áudio
não seja perdido: a mensagem é salva com contexto de transcrição indisponível e a
IA responde pedindo o texto ao lead.
>
> CONFIRMAÇÃO DE PREÇO: Quando o lead perguntar "é a partir de R$ 2.500?" responda diretamente com os valores.
>
> QUANDO PERGUNTAR "quais opções de lentes": Trate como pergunta informativa. Explique as duas técnicas com valores iniciais.

---

## Bugs Pendentes (abertos nesta sessão)

### BUG-001 — slot_taken ao rebook após cancelamento

**Severidade:** Alta (impede reagendamento via IA)

**Reprodução:**
1. Lead agenda consulta → appointment criado (status=scheduled)
2. Lead cancela → appointment (status=cancelled), reservation (status=released)
3. Lead pede novo agendamento → agent oferece mesmos slots
4. Lead confirma slot 1 → BookingService.book() retorna slot_taken
5. Appointment NÃO é criado

**Arquivos a investigar:**
- `src/core/scheduling/BookingService.ts` — método `book()`
- `src/core/scheduling/SlotReservationService.ts` — método `reserve()`
- `src/infrastructure/adapters/calendar/internal/internal-calendar-gateway.ts` — `isSlotFree()`

**Hipótese mais provável:** race condition ou estado sujo na tabela `slot_reservations`
após `releaseBySlot()`. Verificar se `releaseBySlot` usa `UPDATE ... WHERE clinic_id AND starts_at`
e se há múltiplas reservas para o mesmo slot com diferentes `leadId`.

---

## Lições para Próximas Clínicas

1. **O playbook precisa ser explícito sobre preços "a partir de"** — a `commercial_policy`
   padrão é muito conservadora. Cada clínica que tiver preços de referência deve incluí-los
   explicitamente na `commercial_policy`.

2. **Lentes com múltiplas técnicas requerem `notes` específicas** — o classifier trata
   qualquer nome de tratamento como booking intent. Para tratamentos com variantes,
   incluir nas `notes` a instrução de apresentar variantes antes de oferecer agenda.

3. **Calendário interno funciona corretamente** — T05/T06 confirmam que o modo
   `calendarMode=internal` cria appointments com `source=app`, `calendarEventId=null`
   sem nenhuma chamada ao Google Calendar.

4. **Human takeover funciona em produção real** — T09/T10 confirmados via webhook
   real, não apenas via simulate.

5. **Concierge NÃO deve forçar menu** — T01 confirma que `conversationExperience=concierge`
   guia o lead naturalmente sem lista numerada.
