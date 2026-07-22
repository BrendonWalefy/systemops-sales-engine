# Motor de Reativação — plano de execução

Companion de [ADR-009](../architecture/adr/adr-009-motor-reativacao.md). Este doc é o mapeamento operacional: o que existe, o que muda, arquivo a arquivo, fase a fase.

**Data:** 2026-07-22
**Origem:** direcionamento escrito pelo cliente-piloto (Vitalli) à recepcionista — follow-up segmentado por motivo de não-fechamento + oferta com prazo.
**Escopo:** feature global, configurável por qualquer clínica. Nada hardcoded para Vitalli.

---

## 1. Mapa do que já existe (não reconstruir)

| Peça | Arquivo | Como o motor usa |
|---|---|---|
| Enfileiramento na outbox | `src/application/jobs/enqueue-outbound-message.ts` | Único caminho de saída da campanha |
| Safety Gate (opt-out, caps, quiet hours, warmup) | `src/application/channel-safety/outbound-safety-gate.ts` | Aplicado automaticamente à categoria `campaign` |
| Guard de destino + lifecycle do envio | `src/application/jobs/send-message-job.ts` | **Restringe o desenho do modo ensaio** (ver §5) |
| Categoria `campaign` no enum | `src/infrastructure/db/schema.ts` (`outbound_message_category`) | Já existe e já é gated — nada a criar |
| Reputação do número | `src/application/channel-safety/reputation-engine.ts` | Modo `cooling`/`frozen` cancela campanha sozinho |
| Pausa de reengajamento | `src/application/channel-safety/reengagement-policy.ts` | Kill switch por clínica, reusado |
| Disparo em lote de referência | `src/app/api/cron/recovery-campaign/route.ts` | Modelo do fluxo: compõe → `messages` → outbox |
| Oferta promocional por tratamento | `price_campaigns` + `src/app/(clinic)/app/settings/tratamentos/campaign-actions.ts` | FK da campanha — a oferta **não** é reinventada |
| Follow-ups agendados | `follow_ups` + `src/app/api/cron/follow-up-dispatcher/route.ts` | Cap lifetime e janela por lead |
| LLM forte com roteamento Claude/OpenAI | `src/infrastructure/llm/advisor-llm.ts` | Classificação e redação — **precisa devolver `usage`** |
| Rastreio de custo de IA | `ai_usage_costs` + `src/application/services/default-usage-cost-tracker.ts` | Teto por clínica |
| Módulos vendáveis por plano | `src/application/modules/module-catalog.ts` | `reactivation_engine` entra aqui |
| Timezone e janela de contato | `src/core/scheduling/ClinicTimezone.ts` | Nunca calcular horário na mão |

## 2. Lacunas confirmadas por leitura de código

- `leads.lost_reason` é `text` livre e o **único** escritor é `mark-stale-leads.ts:24`, que grava o literal `"inatividade"`. Não existe classificação de motivo em lugar nenhum.
- As exclusões de segurança do disparo em lote estão em SQL literal dentro de `recovery-campaign/route.ts:72-86` (janela de 7 dias, cap lifetime de 3). Não são reutilizáveis nem testáveis isoladamente.
- `callAdvisorLLM` descarta `usage` — todo gasto de LLM do advisor, insights e setup study é **invisível** em `ai_usage_costs` hoje.
- `AI_MODEL_PRICES` em `cost-estimator.ts` só conhece modelos OpenAI. Qualquer chamada Claude estima custo zero.
- `aiOperationEnum` não tem valor para operações de reativação.

---

## 3. Fase 1 — Motivo de não-fechamento (zero risco de envio)

Entrega isolada e útil sozinha: responde "por que meus pacientes não fecharam", com evidência. Não envia nenhuma mensagem.

### Schema

`src/infrastructure/db/schema.ts`:

- `leadOutcomeReasonEnum` — `price`, `schedule`, `location`, `fear`, `third_party_decision`, `competitor`, `treatment_mismatch`, `no_response`, `already_treated`, `other`.
- `leadOutcomeSourceEnum` — `llm`, `human`, `system`.
- Tabela `lead_outcomes`: `clinicId`, `leadId`, `conversationId`, `reason`, `evidenceExcerpt` (trecho literal), `evidenceMessageId`, `confidence` (0-100), `source`, `model`, `classifiedAt`, `sourceMessageId` (última mensagem vista — evita reclassificar de graça).
- Índice único `(clinic_id, lead_id)`: um outcome corrente por lead. Correção humana sobrescreve; `source = 'human'` nunca é sobrescrito por `'llm'`.
- Novo valor em `aiOperationEnum`: `lead_outcome_classification`.

Migração gerada com `npm run db:generate` — **nunca** editada à mão (AGENTS.md).

### Código

| Arquivo | Responsabilidade |
|---|---|
| `src/core/intelligence/LeadOutcomeClassifier.ts` | Puro: monta prompt, parseia e valida resposta. Sem I/O, testável. |
| `src/application/reactivation/classify-lead-outcomes.ts` | Use case: busca conversas elegíveis, chama LLM, persiste, registra custo. |
| `src/infrastructure/repositories/drizzle-lead-outcome-repository.ts` | Persistência. |
| `src/app/api/cron/lead-outcome-classifier/route.ts` | Cron diário, multi-clínica, com teto de custo. |
| `scripts/relatorio-motivos.ts` | Relatório por clínica: nome, tratamento, motivo, trecho. Uso comercial imediato. |

### Custo

| Arquivo | Mudança |
|---|---|
| `src/infrastructure/llm/advisor-llm.ts` | Passar a devolver `{ text, usage, model }`. Callers atuais continuam funcionando via helper compatível. |
| `src/application/services/cost-estimator.ts` | Adicionar preços Claude (`claude-sonnet-5`, `claude-opus-4-8`, `claude-haiku-4-5`). |
| `src/application/reactivation/cost-guard.ts` | Teto diário por clínica sobre `ai_usage_costs`; estourou, adia. |

Modelo: `claude-sonnet-5` (env `REACTIVATION_MODEL`). Ver ADR-009 para a justificativa de custo.

### Testes

- `LeadOutcomeClassifier.test.ts` — parsing, resposta malformada, motivo fora do enum, confiança fora de faixa.
- `LeadOutcomeHumanOverride.test.ts` — `human` não é sobrescrito por `llm`.
- `ReactivationCostGuard.test.ts` — teto respeitado.

---

## 4. Fase 2 — Audiência e campanha em rascunho (zero risco de envio)

### Schema

- `reactivation_campaigns`: `name`, `segment` (jsonb validado), `priceCampaignId` (FK opcional), `deadlineAt`, `status` (`draft|reviewing|approved|running|paused|done|cancelled`), `messageMode` (`ai_per_lead|template`), `templateText`, `dailySendCap` (default 30), `testLeadId`, `createdByUserId`, `approvedByUserId`, `approvedAt`.
- `reactivation_campaign_targets`: `campaignId`, `leadId`, `conversationId`, `status` (`pending|approved|rejected|queued|sent|skipped|failed|replied|converted`), `draftMessage`, `editedMessage`, `skipReason`, `outboundMessageId`, `sentAt`, `repliedAt`, `convertedAppointmentId`. Único `(campaign_id, lead_id)`.

### Código

| Arquivo | Responsabilidade |
|---|---|
| `src/application/reactivation/audience-segment.ts` | Schema declarativo do segmento + validação. |
| `src/application/reactivation/audience-resolver.ts` | Resolve segmento → leads. **Extrai as exclusões hoje literais em `recovery-campaign/route.ts:72-86`.** |
| `src/application/reactivation/preview-audience.ts` | Contagem + amostra, obrigatório antes de aprovar. |
| `src/application/reactivation/draft-campaign-messages.ts` | Gera rascunho por lead (motivo + oferta + prazo no contexto). |
| `src/app/(clinic)/app/campanhas/` | UI: criar, ver preview, **revisar em lote** (seleção múltipla, aprovar/editar/rejeitar), aprovar. |

O `recovery-campaign` passa a consumir o `AudienceResolver` em vez do SQL literal — mesma política, um dono só.

---

## 5. Fase 3 — Envio seguro

### Modo ensaio (validação com número real)

Constraint descoberta lendo `send-message-job.ts`: existe um guard `automationDestinationMatchesLead(payload.to, context.lead)` que **cancela** o envio como `invalid_automation_context` quando o destino não corresponde ao lead da conversa. Consequência de desenho:

> Modo ensaio **não** troca o `to` da outbox. Ele redireciona `conversationId` **e** `to` para o lead de teste da clínica, e prefixa a mensagem identificando o destinatário real.

Requisitos:

- A clínica cadastra um lead de teste (para a validação inicial: o número do Brendon, `11 92038-4039`).
- Rascunhos são gerados contra os leads reais — o conteúdo testado é o conteúdo de verdade.
- Nada é gravado na conversa do lead real.
- Cap próprio no modo ensaio (o número de teste receberia a campanha inteira; espaçamento obrigatório).

### Disparo real

- Enfileira via `enqueueOutboundMessage` com `category: "campaign"`, respeitando `dailySendCap` da campanha **além** dos caps da clínica.
- `dedupeKey` determinístico `campaign:{campaignId}:{leadId}` — reexecução do cron não duplica.
- Pré-registro em `messages` antes da outbox (mesmo padrão do recovery).
- Kill switch: `automated_reengagement_paused` (já existe) + `status: paused` na campanha.
- Aprovação humana obrigatória enquanto `approvedAt` for nulo.

### Ordem de validação (não pular etapas)

1. Testes automatizados verdes.
2. Campanha em modo ensaio contra o número de teste, em ambiente de produção.
3. Conferência manual das mensagens recebidas.
4. Campanha real com cap baixo (≤ 30/dia) e audiência pequena.
5. Só então cap normal.

---

## 6. Fase 4 — Contexto na conversa e métricas

- Quando o lead responde a uma campanha, o orquestrador precisa saber qual oferta foi enviada e até quando vale — senão a IA cota preço cheio e mata a campanha na primeira resposta. Regra do `AGENTS.md` intacta: o sistema decide qual oferta e qual prazo, a LLM verbaliza.
- **Pré-requisito:** corrigir `garantia-objecao-nao-surge`.
- Painel por campanha: enviados, responderam, agendaram, R$ estimado.

---

## 7. Guardrails que valem para todas as fases

1. Nenhum envio fora da outbox. Zero chamadas diretas a `sendTextMessage` no motor.
2. Nenhum comportamento específico de clínica em código — tudo em tabela com default no código (`sources-of-truth.md`).
3. Toda mudança de `schema.ts` acompanha migração gerada, em commit próprio.
4. `npm run verify` antes de qualquer push.
5. Revisão do `revisor-multitenant` antes do PR — o diff toca repositórios Drizzle, rotas de API e orquestração.
6. **Ximendes e Vitalli estão em produção.** Qualquer alteração no caminho de envio compartilhado exige atenção redobrada; preferir adicionar caminho novo a modificar o existente.

## 8. Estado de execução

- [x] ADR-009 + este plano
- [ ] Fase 1 — schema + migração
- [ ] Fase 1 — classificador + testes
- [ ] Fase 1 — instrumentação de custo
- [ ] Fase 1 — cron + relatório
- [ ] Fase 2
- [ ] Fase 3
- [ ] Fase 4
