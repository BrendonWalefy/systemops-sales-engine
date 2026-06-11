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

## Backlog priorizado (não corrigido nesta rodada)

### Antes da clínica 2
1. **Onboarding sem scripts**: os `scripts/seed-bw-*`/`patch-bw-*` são legado da
   piloto. Mudança editorial deve ir pela UI de playbook
   (`/app/settings/playbook`). Mapear o que ainda NÃO é editável pela UI
   (trigger templates? mediaLibrary? installment rates?) e fechar esses gaps.
2. **Google Calendar sync token 410 Gone**: `calendar-watch-renew` não trata token
   stale — entra em loop de falha e a sincronização morre em silêncio. Resetar o
   token (full resync) ao receber 410.
3. **`addMonths` naive** no follow-up de 6 meses (`schedule-follow-up.ts`):
   fim de mês/DST deslocam a data. Usar aritmética via `ClinicTimezone`.

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
