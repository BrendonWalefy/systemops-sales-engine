# Roadmap de produto — SystemOps Sales Engine

Atualizado: 2026-07-06. Norte: **fechar e operar bem o 1º cliente pago
(Clínica Vitalli)** e transformar essa implantação num processo repetível de
venda + setup. Prioridade única por vez; P0 tem prazo real.

## Linha do tempo da Vitalli (âncora das prioridades)

- 06/07 — WhatsApp conectado, **shadow mode coletando** (feito).
- ~20/07 — fim das 2 semanas de shadow → **estudo de setup + validação do
  Dr. Victor** (ADR-002) → aplicar config → **go-live** com preset
  conservador do channel safety (caps 15/60, reengajamento pausado,
  reply-only).

## P0 — com prazo (destrava o go-live da Vitalli, ~20/07)

| # | Item | Spec | Esforço |
|---|---|---|---|
| 1 | **Setup Study — Fase 1** (motor + tabela + curadoria draft) | `docs/architecture/adr/adr-002-shadow-study-setup-validation.md` | 2–3 dias |
| 2 | **Setup Study — Fase 2** (página pública de validação `/validacao/[token]`) | ADR-002 | 2 dias |
| 3 | **Setup Study — Fase 3** (diff + aplicação no owner) | ADR-002 | 1–2 dias |
| 4 | Go-live Vitalli: aplicar preset conservador + desligar shadow (operação, não código) | `docs/product/channel-safety-vitalli-handoff.md` | — |

Ordem estrita 1→2→3; o ADR-002 tem apêndice de execução com todas as decisões
fechadas (allowlist, anonimização, contrato do prompt, arquivos).

## P1 — logo depois (ou em paralelo por outro agente)

| # | Item | Spec | Esforço |
|---|---|---|---|
| 5 | **Painel owner — Fase A** (3 abas + zona de perigo + header com CTA) | `docs/architecture/adr/adr-006-owner-panel-restructure.md` | 1–2 dias |
| 6 | **Painel owner — Fase B** (timeline de implantação v1) | ADR-006 | 1–2 dias |
| 7 | Onboarding comercial guiado (etapas 2+ do handoff — em andamento) | `docs/product/onboarding-comercial-guiado-handoff.md` | — |

O item 6 fica melhor se o ADR-002 Fase 1 já existir (timeline mostra a etapa
do estudo), mas não bloqueia. Executor sugerido do 5–6: agente `designer-ux`.

## P2 — antes do 2º cliente

| # | Item | Spec | Esforço |
|---|---|---|---|
| 8 | ~~Provisionamento Z-API — Fase 1~~ **feito** (PR #134, 06/07) — falta o operacional: definir `ZAPI_PARTNER_TOKEN` e `ZAPI_ACCOUNT_CLIENT_TOKEN` no Vercel | `docs/architecture/adr/adr-005-zapi-instance-provisioning.md` | — |
| 9 | Provisionamento Z-API — Fases 2–3 (assinatura, `ZAPI_WEBHOOK_SECRET`, drift check) | ADR-005 | 2–3 dias |
| 10 | Channel safety — P1/P2 pendentes do handoff Vitalli (endurecer opt-out, observabilidade do gate) | `docs/product/channel-safety-vitalli-handoff.md` | — |

## P3 — backlog priorizado (sem data)

- **ADRs propostos aguardando análise macro** (não executar sem refinamento):
  `adr-003-whatsapp-provider-decoupling.md` (factory de ChannelAdapter para
  novos provedores) e `adr-004-tiered-ai-models-architecture.md` (modelos de
  IA por tier/caso de uso). Status "Proposto" — priorizar quando houver
  demanda real (2º provedor / reclamação de qualidade por plano).
- **Vitrine AI** (módulo, 4 fases) — ADR:
  `docs/architecture/adr/adr-007-vitrine-ai-module.md` (pronto para execução);
  plano de produto em `docs/product/vitrine-ai-plano-execucao.md`. Fase 0
  pode adiantar como "uau" de demo se surgir venda no segmento decoração.
- **Excelência conversacional** — backlog no handoff do plano; ganha um
  gabarito novo quando o setup study existir (comparação IA shadow × humano).
- **Painel owner — Fase C** (consolidar wizard/blueprint na timeline; home).
- Config ownership — roadmap pendente (itens 1–2 em develop).
- Fluxo de **sinal nativo** (reserva provisória + validação de comprovante) —
  `docs/product/ficha-setup-clinica.md` Parte 2 item 5. Sobe para P1 se o
  volume da Vitalli provar a dor no go-live.
- Bug Sentry: upload de avatar 400 (Server Action /app/dashboard).

## Regras para qualquer executor

1. PR baseado na `main` atualizada (develop está defasada); `npm run verify`
   verde; agente `revisor-multitenant` antes de cada push.
2. Migração drizzle sempre em commit próprio.
3. Os ADRs têm apêndices "não reabrir" — decisões já tomadas; dúvidas de
   produto não listadas lá, perguntar ao owner em vez de supor.
