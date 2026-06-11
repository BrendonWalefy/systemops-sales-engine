# Estudo de Defeitos e Roadmap de Escala — Junho/2026

Análise completa do repositório feita em 11/06/2026, motivada pelo bug recorrente de
mensagens fora de ordem na clínica piloto (vídeo da Técnica Estratificada entregue
~5 minutos atrasado, depois da resposta de localização). Três frentes de auditoria
(pipeline de conversa, agendamento/follow-up, arquitetura/escala) com verificação
manual dos achados contra o código.

Critérios definidos pelo produto: **sem Frankenstein** (nada de infra nova
desnecessária, sem rewrite do orquestrador), **responsabilidade de cada peça
preservada**, e evolução de arquitetura **incremental** — 1 clínica hoje, 10–50 depois.

## Restrições de plataforma que moldam qualquer correção

- **Driver `neon-http`** (`src/infrastructure/db/client.ts`): cada query é uma
  requisição HTTP independente. **Não há transações interativas** — atomicidade
  só por single-statement CAS (`UPDATE ... WHERE` com `RETURNING`,
  `INSERT ... ON CONFLICT`) ou constraints no banco.
- **Vercel serverless**: sem locks em memória entre invocações, sem processos
  longos, sem Redis no stack. Webhook responde 200 imediato e processa via
  `after()` (maxDuration 60s).
- **Z-API entrega mídia por URL de forma assíncrona**: o ACK do POST significa
  "aceito na fila", não "entregue". Qualquer garantia de ordem construída só no
  app desaparece na fila da Z-API.

## Defeitos críticos (corrigidos nesta rodada)

| # | Defeito | Onde | Correção aplicada |
|---|---------|------|-------------------|
| 1 | Mídia fora de ordem: `await` no envio confirma ACK, não entrega; textos posteriores ultrapassam o vídeo | `ConversationOrchestrator` loops 9.1/9.2 + `zapi-channel-adapter` | `OutboundDeliveryService`: poll no message-status até a mídia sair da fila antes da próxima parte; degradação graciosa em timeout/endpoint indisponível |
| 2 | Webhooks da mesma conversa processam em paralelo (TOCTOU no debounce) → respostas intercaladas/duplicadas | `ConversationOrchestrator.handle()` | Claim por conversa via CAS em `conversations.processing_until` (migration 0022); perdedor espera e re-verifica; TTL 90s anti-deadlock |
| 3 | Resposta vazia silenciosa: flake da OpenAI devolvia `text=""` sem erro; mensagem vazia "enviada" | `ResponseComposer.compose()` + guard ausente no orquestrador | Retry único + throw se vazio; guard antes do envio cai no fallback determinístico existente |
| 4 | Follow-up duplicado: dispatcher enviava e só depois marcava `done`; crash/re-run = reenvio | `follow-up-dispatcher` | Status `sending` (migration 0023) + claim atômico pending→sending antes do envio; stale >30min volta a pending |
| 5 | Reservas de slot sobrepostas com `starts_at` diferentes passavam (unique só pega colisão exata; pré-check é TOCTOU) | `slot_reservations` + `SlotReservationService` | Exclusion constraint gist com `tstzrange` (migration 0024); caminho de reuso via UPDATE agora captura a violação |
| 6 | Logs não estruturados, sem correlação — debug de produção era arqueologia | todo o código | `createLogger` (JSON de linha única com correlationId/clinicId/conversationId); adotado nos pontos quentes |
| 7 | Injeção de prompt: playbook/política interpolados crus no system prompt | `ResponseComposer.buildSystemPrompt` | Fencing `<dados_da_clinica>` + regra de não-sobrescrita de identidade/escopo + anti-escape |

## Achados de auditoria que NÃO se confirmaram (não gastar tempo neles)

- **"Não há proteção de double-booking"** — falso. Existe saga real
  (`BookingService` + `SlotReservationService`): lock otimista, re-check de
  overlap em appointments, re-check no calendar gateway. O gap real era o
  item 5 acima (intervalos sobrepostos), já fechado.
- **"Constantes operacionais hardcoded por clínica"** — desatualizado. `rateLimitPerHour`,
  `messageDebounceMs`, `rapidThrottleMs`, `staleConversationHours`,
  `mediaTakeoverTtlHours`, `unclearThreshold`, `slotOfferTtlMinutes` etc. já vêm
  de `clinic.*` no orquestrador.
- **"Usar `db.transaction` nas operações multi-step"** — inviável com `neon-http`.
  O padrão correto aqui é CAS de single-statement + constraints, que foi o aplicado.

## Pontos fortes a preservar

- Multi-tenancy limpo: todo acesso escopado por `clinicId`.
- Abstração de canal (`ChannelAdapter`): Z-API ↔ Meta sem tocar no domínio.
- Estado de conversa persistido (append-only) em vez de inferido por texto.
- Config editorial versionada em `playbook_versions` com schema de validação.
- `ClinicTimezone` centralizado; suite de testes ampla (49 arquivos).

## Rodada 2 — auditoria de segurança e calendário (corrigida em 11/06)

Segunda varredura (4 frentes: calendário, onboarding, IA, API/crons) com
verificação manual. Tema dominante: **autenticação/tenancy**, não concorrência.

| # | Defeito | Onde | Correção aplicada |
|---|---------|------|-------------------|
| 8 | `advisor/publish` e `advisor/analyze` SEM autenticação — qualquer um na internet reescrevia o playbook ativo (comportamento da IA) de qualquer clínica | `api/playbook/advisor/*` | Sessão obrigatória + `clinicId` do body precisa ser o da sessão (403 se divergir) |
| 9 | Rotas de conversa autenticavam mas não filtravam por clínica da sessão: usuário da clínica B lia mensagens (PII), enviava WhatsApp e pausava a IA da clínica A | `conversations/[id]/messages`, `/send`, `/register-appointment` | Escopo por `clinicId` da sessão no lookup da conversa (mesmo padrão da rota `/read`, que já fazia certo) |
| 10 | Webhook Z-API aceitava POST de qualquer origem (Z-API não assina webhooks) — spoof de leads, custo OpenAI | `api/whatsapp/zapi` | Secret compartilhado na URL (`?secret=`) validado quando `ZAPI_WEBHOOK_SECRET` estiver definida — rollout em 2 passos sem downtime |
| 11 | Sync token 410 Gone congelava a sincronização GCal para sempre (webhook engolia com 200, cron só logava, ninguém resetava) | `google-calendar-gateway.syncCancelledEventIds` | Auto-recuperação: 410 + token → refaz sync inicial (timeMin 180d) e devolve token novo |
| 12 | Webhook GCal persistia o syncToken ANTES de processar cancelamentos — falha no meio perdia os eventos para sempre | `webhooks/google-calendar` | Inverte a ordem: processa primeiro (idempotente), token avança só no fim; falha = re-entrega no próximo sync |

**Operacional (rollout do item 10):** 1) adicionar `?secret=<valor>` na URL do
webhook no painel Z-API; 2) definir `ZAPI_WEBHOOK_SECRET` no Vercel. Enquanto a
env não existir, o comportamento é o atual (sem validação).

**Achados de agente descartados na verificação manual desta rodada:** "clock
skew no estado de conversa", "playbook inválido derruba o Composer" (tolera
null — vira bot genérico), fail-open do `isSlotFree` (decisão consciente já
documentada na rodada 1).

## Backlog priorizado (não corrigido nesta rodada)

### Antes da clínica 2
1. **Onboarding sem scripts**: seeds editoriais manuais são legado do piloto.
   Mudança editorial deve ir pela UI de playbook
   (`/app/settings/playbook`). Mapear o que ainda NÃO é editável pela UI
   (trigger templates? mediaLibrary? installment rates?) e fechar esses gaps.
2. **Flag `isActive` em `clinics`**: crons processam clínica cancelada para
   sempre; webhook aceita clínica com cadastro incompleto. Adicionar flag +
   filtro em `listAllClinicIds`.
3. **`addMonths` naive** no follow-up de 6 meses (`schedule-follow-up.ts`):
   fim de mês/DST deslocam a data. Usar aritmética via `ClinicTimezone`.
4. **`activatePlaybookVersion` (UI) sem gate de validação**: a rota do advisor
   valida com `publishablePlaybookSchema`, mas a ativação manual na UI não —
   dá para ativar versão incompleta (IA vira bot genérico, não quebra).
5. **`max_tokens: 350` no composer pode truncar tag `[MEDIA:` no meio** —
   mídia some da resposta. Detectar tag incompleta no fim do texto e remover.

### Antes de 10 clínicas
4. **Credenciais Z-API/Meta em plaintext** na tabela `clinics` — mover para
   secret manager (ou no mínimo criptografia app-level) por LGPD.
5. **Orquestrador 2,4k linhas**: extrair handlers por intent (AppointmentManager,
   MediaHandler) — extração oportunista, quando cada área for tocada; sem big-bang.
6. **Retry/backoff nos gateways** (Google Calendar, OpenAI classifier) e
   monitoramento de cota do Neon (HTTP driver = 1 query/request).
7. **`findPendingByReason` ignora `dueAt`**: follow-ups com mesma reason e
   datas diferentes são silenciosamente descartados.

### Quando for o momento (50 clínicas)
8. Outbox/fila real para outbound (hoje: entrega síncrona com confirmação por
   conversa — suficiente enquanto o volume por conversa é baixo).
9. Máquina de estados para status de appointment (hoje qualquer transição é aceita).
10. Validação semântica do playbook no publish (consistência com treatments).

## Convenções de migração (aprendido nesta rodada)

O migrator (`scripts/migrate.ts`, drizzle neon-http) segue o `_journal.json` —
arquivos SQL fora do journal NÃO são aplicados por ele. Já existiam SQLs
manuais (0017–0021) fora do journal, aplicados por outra via; as migrations
novas desta rodada (0022, 0023, 0024) estão no journal. Atenção: a 0024 falha
se houver reservas `confirmed` historicamente sobrepostas — nesse caso, tratar
os dados manualmente antes de reaplicar.
