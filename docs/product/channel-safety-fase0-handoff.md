# Handoff — Channel Safety Fase 0 (implementação)

Plano executável da Fase 0 do Channel Safety Engine. Contexto e decisões de
produto em `docs/product/channel-safety-engine-refinado.md` (ler primeiro).
Pesquisa original em `systemops_channel_safety_engine.md` + PDF homônimo.

Data: 2026-07-05. Urgência: o próximo cliente (Clínica Vitalli) vai conectar um
número **que já carrega risco** — o dono já tentou automações por conta própria
e o número recebe alto volume de campanhas. Os gates desta fase precisam estar
em produção antes de plugar esse número.

## Regras de trabalho (obrigatórias)

- Fluxo de branch atual: **basear PRs em `main`** (develop está defasada;
  Vercel roda migração no deploy de produção sozinho).
- `npm run verify` antes de todo push/PR.
- Mudança de schema/migração em commit próprio (AGENTS.md).
- Testes obrigatórios: o escopo toca conversação, webhook-adjacente, contratos
  de banco e decisão de intent — tudo na lista do AGENTS.md.
- Rodar o agente `revisor-multitenant` sobre o diff antes de cada push.
- Regra de ouro do repo: **regra de negócio em código determinístico, nunca em
  prompt/playbook**. Todos os gates são código.
- Validação manual segura: usar clínica de teste com `shadowModeEnabled=true`
  (o fluxo roda inteiro e persiste tudo, mas nada sai para o WhatsApp).

## Mapa do território (já verificado no código — não redescobrir)

| Fato | Onde |
| --- | --- |
| Outbox existe: `outbound_messages` + fila `message.send`; enqueue em `enqueueOutboundMessage` | `src/application/jobs/enqueue-outbound-message.ts` |
| Sender worker consome a outbox; **só aceita `ConversationOutboundPayload`** e lança erro para outro formato | `src/application/jobs/send-message-job.ts` (guard `isConversationOutboundPayload`) |
| Ordenação por conversa via `sequence` + `hasEarlierActiveMessage`; dedupe por `dedupeKey`; claim atômico | `send-message-job.ts`, `outbound-message-store` |
| `jobs.runAt` existe com índice → **defer é update de `runAt`, não gambiarra** | `schema.ts` tabela `jobs` |
| 3 automações enviam DIRETO (fora da outbox): `appointment-reminder` e `follow-up-dispatcher` via `sendVoiceOrText`, `recovery-campaign` via `sendTextMessage` | `src/app/api/cron/*/route.ts` |
| `appointment-reminder-staff` usa **web push**, não WhatsApp → fora do escopo | verificado |
| `organizations.rateLimitPerHour` é limite de **INBOUND por conversa** (anti-flood de lead, `ConversationOrchestrator` ~linha 1776) → **não reutilizar para outbound** | `schema.ts`, orchestrator |
| Policy de automação por clínica já tem padrão: port `ClinicAutomationPolicyReader` (`canSendAutomatedReply`) lendo `autoReplyEnabled` | `src/application/ports/clinic-automation-policy-reader.ts` |
| Módulos por clínica com UI de toggle pronta no owner: `clinic_modules` + `module-catalog.ts` + `module-gate.ts` | `src/application/modules/` |
| Queda de sessão já alerta owner por e-mail | `api/cron/channel-health-alert` |
| Intents em união de tipos + prompt | `src/core/intelligence/IntentClassifier.ts:30` (`IntentType`) |
| Lead tem unique (org, phone); sem nenhum campo de consentimento | `schema.ts` tabela `leads` |
| Fluxo conversacional pré-cria a linha em `messages` e o sender atualiza (`payload.agentMessageId`) — seguir esse padrão nas automações | `send-message-job.ts` |

## Entregas — 6 PRs na ordem

### PR 1 — Schema (migração em commit próprio)

1. Enum `outbound_message_category`: `reply | follow_up | reminder | recovery | campaign | operational`.
2. `outbound_messages.category` NOT NULL DEFAULT `'reply'` (default preserva o
   comportamento atual do fluxo conversacional).
3. `leads.contact_consent_revoked_at` (timestamptz, null) +
   `leads.contact_consent_source` (text, null). Semântica: `revoked_at != null`
   = opt-out ativo. Sem enum — reversão é limpar o campo.
4. `organizations.outbound_hourly_cap` int NOT NULL DEFAULT 40 e
   `organizations.outbound_daily_cap` int NOT NULL DEFAULT 200 (valores a
   calibrar; conservadores de propósito).

Aceite: `npm run verify` verde; nenhum comportamento muda (default `reply`).

### PR 2 — Safety Gate no sender worker

1. Payload vira união discriminada: `ConversationOutboundPayload` (atual) +
   `AutomationOutboundPayload` (`kind`, `to`, `text`, `leadId`,
   `conversationId`, `agentMessageId` pré-criado, `useVoice?`, `ttsConfig?`).
2. Em `SendMessageJobHandler.processJob`, após o claim e antes da entrega,
   aplicar gates **nesta ordem** (primeiro que falhar decide):

   | # | Gate | Falha → ação | Categorias sujeitas |
   | --- | --- | --- | --- |
   | 1 | Consentimento: lead com `contact_consent_revoked_at`? | `cancel` (status `cancelled`, `lastError` = `"consent_revoked"`) | `follow_up`, `recovery`, `campaign` (reply e reminder passam — ver política abaixo) |
   | 2 | Cap horário/diário da clínica estourado? | `defer` (update `jobs.runAt` para +30–60min com jitter; outbound continua `pending`) | `follow_up`, `recovery`, `campaign` (reply/reminder contam nos contadores mas nunca bloqueiam) |
   | 3 | Quiet hours: fora da janela `businessHours` da clínica (via `ClinicTimezone`)? | `defer` para próxima abertura | `follow_up`, `recovery`, `campaign` |

   Política por categoria (decisão de produto, já tomada):
   - `reply`: sempre passa (lead acabou de falar; bloquear silenciaria o
     atendimento). Conta nos contadores.
   - `reminder`: passa mesmo com opt-out (é aviso de compromisso que o próprio
     lead marcou) e é isento de quiet hours (já é agendado para hora certa).
   - `operational`: sempre passa.
3. Contagem de caps: query em `outbound_messages` por `clinicId` +
   `sentAt >= janela` + `status = 'sent'` — barata na escala atual, sem tabela
   nova.
4. Cuidado com ordenação: `defer` de uma mensagem mantém as posteriores da
   mesma conversa seguras — `hasEarlierActiveMessage` já segura a fila; não
   inventar bypass.
5. Testes: unit do gate (cada regra, cada categoria), incluindo defer não
   quebrar `sequence`.

Aceite: fluxo conversacional atual passa intacto pelos gates (categoria
`reply`); automação simulada com opt-out é cancelada com razão persistida.

### PR 3 — Migrar `follow-up-dispatcher` para a outbox

- O cron passa a: compor o texto (como hoje), pré-criar a linha em `messages`,
  chamar `enqueueOutboundMessage` com `category: "follow_up"` e payload de
  automação. Remover o envio direto via `sendVoiceOrText`.
- `dedupeKey` determinístico por follow-up (ex.: `followup:{followUpId}`) para
  reexecução de cron não duplicar envio.
- Teste: reexecutar o cron não gera segundo envio; opt-out bloqueia.

### PR 4 — Migrar `recovery-campaign` (+ toggle por módulo)

- Mesmo padrão do PR 3, `category: "recovery"`, `dedupeKey` por
  lead+campanha+tentativa. O cap lifetime de 3 por lead permanece no cron.
- Adicionar module key `recovery_campaign` ao `module-catalog.ts` e checar via
  `module-gate` no início do cron (por clínica). **A UI de toggle no owner já
  existe** (`owner/clinics/[clinicId]/modules`) — ganho grátis: dá para
  desligar recovery para a Vitalli sem deploy.

### PR 5 — Migrar `appointment-reminder`

- Mesmo padrão, `category: "reminder"`, `dedupeKey` por appointment+janela.
- Lembrar: reminder é isento de opt-out e quiet hours (tabela do PR 2).

### PR 6 — Intent `stop_contact` + regra determinística (agente: engenheiro-conversa)

1. `IntentClassifier`: novo intent `stop_contact` com exemplos PT-BR:
   "para de me mandar mensagem", "não quero mais receber", "me tira dessa
   lista", "não me chama mais". **Exemplos negativos obrigatórios** (falso
   positivo é o risco real): "não quero esse horário" → `reject_slots`;
   "não quero mais fazer o tratamento" → NÃO é `stop_contact` (é desistência,
   fluxo existente); "para" isolado em contexto de agendamento → `unclear`.
2. `ConversationOrchestrator`: regra determinística para `stop_contact`:
   - grava `contact_consent_revoked_at = now()`, `source = 'lead_message'`;
   - compõe UMA confirmação respeitosa via composer (categoria `reply` — é
     resposta a inbound) e encerra;
   - notifica owner (push existente) — o lead pediu para sair.
3. Política de reversão: opt-out NÃO se auto-reseta se o lead voltar a falar
   (replies funcionam normalmente; só automações ficam bloqueadas). Reversão
   manual limpa o campo (tela owner é nice-to-have, não bloqueia a fase).
4. Testes: casos positivos/negativos no harness de conversa existente + unit
   da regra no orchestrator.

Aceite: lead que pede para parar recebe uma confirmação e nunca mais recebe
follow-up/recovery; continua conseguindo agendar se voltar por conta própria.

## Fora do escopo desta fase (não fazer)

- Health score, temperatura, cooling/frozen dinâmicos, warmup automático,
  painel — Fase 1 (`channel-safety-engine-refinado.md`).
- Pareamento QR no nosso portal — anda em paralelo com o onboarding comercial
  guiado, não bloqueia nem é bloqueado por esta fase.
- Novos providers (Evolution/WAHA) e port formal de adapter — Fase 2.
- Não tocar em BookingService/agenda; não usar `rateLimitPerHour` existente
  para outbound; não colocar nenhuma dessas regras em prompt.

## Preset de onboarding para a Vitalli (número já em risco)

Contexto: o dono já rodou automações próprias e o número recebe muito volume
de campanhas. Ao plugar no SystemOps:

1. **Semanas 1–2: modo reply-only.** Módulo `recovery_campaign` OFF (PR 4) e
   follow-ups desligados ou mínimos. O comportamento conversational-first
   (responder quem chama) é exatamente o que "esfria" um número — plugar no
   SystemOps deve REDUZIR o risco atual dele, desde que as automações entrem
   devagar.
2. **Caps abaixo do default:** `outbound_hourly_cap = 15`,
   `outbound_daily_cap = 60` no início; subir gradualmente com taxa de
   resposta saudável.
3. **Orientar o cliente a pausar as campanhas de disparo que ele faz por fora**
   no mesmo número — o gate não protege tráfego que não passa por nós; isso
   precisa estar no combinado comercial.
4. Monitorar na primeira semana: taxa de resposta, opt-outs (novo intent),
   quedas de sessão (alerta já existe).
5. Nunca prometer anti-ban — o discurso é governança e redução de risco
   (posicionamento no doc refinado).

## Sugestão de alocação

- PRs 1–5: agente executor geral (pipeline/schema/crons), com
  `revisor-multitenant` antes de cada push.
- PR 6: `engenheiro-conversa` (intent + composer + harness).
- Sequência estrita: PR 1 → PR 2 → (3, 4, 5 em qualquer ordem) → 6 pode andar
  em paralelo a 3–5 depois que o PR 1 mergear (o gate de consent do PR 2 já
  lê o campo).
