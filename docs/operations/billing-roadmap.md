# Roadmap de Billing, Entitlements e Precificação

> Preços e mapeamento de features vivem em `docs/product/pricing-strategy.md`.
> Este documento é o backlog técnico ordenado para sair do estado atual (planos como
> enum + preço hard-coded, sem cobrança automática) até um sistema de assinatura real.
> Segue o processo de `docs/operations/change-control.md` (branch por etapa, testes,
> `npm run verify` antes de cada push).

Decisão vigente: **multi-unidade/rede fora de escopo neste roadmap.** Todo o trabalho
abaixo assume clínica única por `organization`.

---

## Fase 0 — Preço novo, sem infraestrutura nova (comece aqui)

Objetivo: vender com a matriz de preços corrigida sem esperar nenhuma fase técnica.

- [ ] Atualizar `PLAN_PRICE_BRL_CENTS` em
  `src/application/onboarding/clinic-commercial-settings.ts` para os novos valores
  (Start R$1.300 / Growth R$2.300 / Scale R$3.500 — ver `pricing-strategy.md`)
- [ ] Atualizar tabela de preços em `docs/product/sales-playbook.md` (seção 5) para
  referenciar `pricing-strategy.md` como fonte oficial, e ajustar os valores de exemplo
  usados nos scripts de ROI/objeção (seção 9)
- [ ] Revisar `MODULE_CATALOG` (`src/application/modules/module-catalog.ts`) contra a
  tabela da seção 2 de `pricing-strategy.md` — hoje `revenue_pipeline` está incluso em
  `avancado`/`rede`; como a feature é parcial, **retirar `revenue_pipeline` do catálogo
  vendável** (deixar só como flag interna, sem promessa comercial) até a Fase 5
- [ ] Time comercial: nenhuma menção a "rede"/multi-unidade em conversa de venda
- Critério de saída: primeiro contrato fechado com a tabela nova

## Fase 1 — Fundação de assinatura (sem gateway de pagamento ainda)

Objetivo: parar de depender de enum fixo + planilha paralela para saber quem está em
qual plano e em que status.

- [ ] Nova tabela `plans`: `id`, `key` (start/growth/scale/enterprise), `name`,
  `priceCents`, `billingInterval`, `limits` (jsonb: conversas/mês, usuários, whatsapps,
  playbooks) — substitui gradualmente `PLAN_PRICE_BRL_CENTS` hard-coded
- [ ] Nova tabela `subscriptions`: `clinicId`, `planId`, `status`
  (`trial`/`active`/`past_due`/`paused`/`cancelled`), `currentPeriodStart`,
  `currentPeriodEnd`
- [ ] Migração de dados: para cada `organization` ativa hoje, criar `subscription`
  correspondente ao `plan` atual com `status = active`
- [ ] Manter `organizations.operationalStatus` como está (não duplicar semântica) —
  `subscriptions.status` é sobre cobrança, `operationalStatus` continua sobre o ciclo
  prospect/test/live da clínica
- [ ] Nova aba em `/owner/financeiro` (ou `/owner/clinics/[clinicId]`) para o time
  interno trocar `subscription.planId` e ver status — cobrança continua manual
  (PIX/boleto)
- [ ] Testes: cobertura equivalente ao padrão do projeto (ver `ClinicCommercialSettings.test.ts`
  como referência de estilo)
- Critério de saída: toda clínica ativa tem `subscription` rastreada; zero planilha

## Fase 2 — Usage metering visível (pode rodar em paralelo à Fase 1)

Objetivo: visibilidade de consumo antes de qualquer bloqueio ou cobrança de excedente.

- [ ] Nova tabela `usage_counters`: `clinicId`, `metric`
  (`conversations`/`ai_messages`/`tts_characters`), `periodStart`, `periodEnd`, `count`
  — agregando dados já coletados em `ai_usage_costs`, `tts_usage_costs` e `messages`
- [ ] Job/cron de agregação diária ou por período de billing (reaproveitar padrão dos
  crons existentes em `src/app/api/cron/`)
- [ ] Exibir no painel owner: uso atual vs. limite do plano (`plans.limits`), por
  clínica
- [ ] Sem bloqueio automático nesta fase — só alerta interno (reaproveitar
  `clinic_operational_insights` como canal) quando uma clínica ultrapassa fair use
- Critério de saída: time identifica upsell olhando o painel, sem SQL manual

## Fase 3 — Entitlement enforcement

Objetivo: o sistema passa a respeitar o plano de verdade — hoje um módulo pode ficar
ativo "por engano" numa clínica de plano inferior sem cobrar por isso.

- [ ] Middleware/guard nas rotas sensíveis (`/api/playbook/advisor/*`,
  `/api/conversations/[id]/suggest-reply`, geração de TTS) checando
  `clinic_modules.isActive` antes de executar
- [ ] Acoplar `syncModulesForPlan()` (já existe em `plan-presets.ts`) à troca de
  `subscriptions.planId`, não a um update manual solto em `clinic_modules`
- [ ] Erro controlado (403 com mensagem clara) quando a clínica tenta usar feature fora
  do plano — nunca crash silencioso
- [ ] Testes de regressão para cada guard adicionado
- Critério de saída: mudar o plano de uma clínica muda o comportamento do produto sem
  intervenção manual em `clinic_modules`

## Fase 4 — Gateway de pagamento

Objetivo: automatizar cobrança recorrente.

- [ ] Avaliar gateway com suporte a boleto/PIX recorrente no Brasil (decisão separada,
  não travar as fases anteriores por isso)
- [ ] Webhook de pagamento atualizando `subscriptions.status` automaticamente
  (`past_due` em falha, `active` em sucesso) — seguir o padrão já usado no webhook de
  Vercel spend (`src/app/api/webhooks/vercel/spend`) como referência de estrutura
- [ ] Dunning simples: aviso por e-mail (reaproveitar infra do Resend já usada no
  digest diário) + pausa automática (`operationalStatus = paused`) após N dias de
  inadimplência
- Critério de saída: cliente pagante não depende de cobrança manual mês a mês

## Fase 5 — Corrigir features parciais (contínuo, priorizado por demanda comercial)

- [ ] `revenue_pipeline`: calcular receita projetada/realizada a partir de
  `appointments.valueCents` em tempo real, substituindo o campo estático
  `organizations.monthlyRevenueBrl` — só então reativar no catálogo comercial (Fase 0
  removeu do que é vendável)
- [ ] Auditar e documentar o cálculo real de `unclear_rate`/`takeover_rate`/
  `conversion_rate` em `clinic_metrics` antes de formalizar como benefício vendável
- [ ] Auditar enforcement de `role` (`team_roles`) na UI/API antes de vender "controle
  de acesso por função" como benefício do Scale
- Priorizar dentro desta fase pela feature que estiver travando um upgrade específico
  em negociação real

---

## Ordem de ataque recomendada

1. **Fase 0 agora** — nenhuma dependência técnica, impacto imediato em vendas.
2. **Fase 1 e 2 em paralelo**, assim que houver 3-5 clientes pagos no preço novo.
3. **Fase 3** quando o gating manual começar a falhar por erro humano (tipicamente
   acima de ~10 clientes).
4. **Fase 4** quando a conciliação manual de cobrança começar a consumir tempo real do
   time (tipicamente acima de ~15-20 clientes).
5. **Fase 5** de forma contínua, sempre puxada por uma venda real travada nessa feature.

Não iniciar Fase 4 antes de Fase 1-3 estarem estáveis — automatizar cobrança sobre uma
base de dados de plano/uso não confiável só move o problema para dentro do gateway de
pagamento.
