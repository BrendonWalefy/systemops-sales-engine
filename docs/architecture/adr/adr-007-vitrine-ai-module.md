# ADR-007: Vitrine AI — módulo de simulação visual de produto

**Status:** Aprovado — implementação pendente (Fase 0 primeiro)
**Data:** 2026-07-06
**Contexto:** Transformar o MVP validado no repo da Linna Cortinas em módulo do sales-engine com providers de imagem plugáveis

---

## Contexto

A Vitrine AI é o simulador visual: o lead envia foto do próprio ambiente,
escolhe produto/variação e recebe a foto com o produto instalado, preservando
a cena. MVP validado em produção na Linna Cortinas com OpenAI
`gpt-image-1.5` (`/v1/images/edits`, `quality: high`).

**Fonte canônica do plano de produto (completa, decidida — não rediscutir):**
`docs/product/vitrine-ai-plano-execucao.md`. Este ADR formaliza a decisão
arquitetural e fecha os detalhes de execução; o plano detalha port, schema,
fases e guardrails.

## Decisão (resumo do plano)

1. **Mora no `systemops-sales-engine`** como módulo com fronteira limpa
   (port + adapters, padrão `src/application/ports/channel-adapter.ts`). O
   core (`src/core/vitrine/`) **não importa domínio de clínica** — extração
   futura para o platform fica mecânica.
2. **Provider plugável desde o dia 1**: port `ImageStagingProvider` (recebe
   bytes+prompt, devolve bytes — nunca URL), registry com resolução
   tenant → env → default. Inicial: OpenAI; `mock` como fallback sem key.
3. **O sistema decide, a LLM verbaliza**: geração disparada por gate
   determinístico (foto no fluxo de vitrine + quota), nunca decisão da LLM.
4. **Metering desde a 1ª geração** (`vitrine_generations` com provider,
   modelo, latência, custo) — billing por plano na Fase 3 lê daqui.
5. **4 fases, um PR por fase**: 0) core + playground owner; 1) integração na
   conversa WhatsApp (assíncrona, mensagem de espera, falha com contorno);
   2) CRUD de catálogo + galeria + métrica de conversão; 3) bench de modelos
   + tiers por plano.

Schema (3 tabelas: `vitrine_catalog_items`, `vitrine_catalog_variants`,
`vitrine_generations`), tipos do port e critérios de aceite por fase: ver o
plano. Toda query filtra por `clinic_id` — guardrail inegociável.

## Apêndice de execução — decisões fechadas (não reabrir)

1. **Código-fonte a portar** (verificado em 06/07/2026, existe):
   - `/Users/brendonwalefy/Dev/Projetos/site-cortinas/dev/linnacortinas/src/lib/api/staging.functions.ts`
     → base do `openai-image-provider.ts` e do `prompt-builder.ts`.
   - `.../src/components/site/BudgetForm.tsx` → referência do fluxo de
     upload; **não** portar o resize 1024×1024 (bug conhecido: distorce a
     geometria — mapear para 1536×1024 / 1024×1536 / 1024×1024 preservando
     proporção, `size` explícito).
2. **Integrações existentes no sales-engine** (verificadas, usar — não
   recriar):
   - Blob: `src/infrastructure/adapters/storage/vercel-blob-storage-gateway.ts`;
     padrão de re-hospedagem de mídia em
     `src/infrastructure/adapters/channels/whatsapp/lead-photo-service.ts`.
   - Imagem inbound do lead: `resolveZApiMedia` no `zapi-channel-adapter.ts`.
   - Envio de imagem: `sendZApiMediaMessage` (send-image + caption).
   - Limpeza: registrar URLs geradas no padrão que `media-cleanup` cron
     conhece, ou marcá-las fora do escopo dele (decidir no PR da Fase 0 e
     documentar no código).
3. **Playground (Fase 0)**: rota
   `src/app/(owner)/owner/clinics/[clinicId]/vitrine/` — tenant pelo
   `clinicId` da rota (nunca seletor solto), auth padrão owner
   (`assertOwnerSession`). Upload direto na página, resultado lado a lado
   com latência e custo.
4. **Config/quotas por tenant**: colunas em `organizations` (padrão do repo,
   sem tabela de settings nova): `vitrine_enabled boolean default false`,
   `vitrine_daily_cap int default 50`, `vitrine_lead_daily_cap int default 3`,
   `vitrine_provider text null` (null = cascata env→default). Migração em
   commit próprio junto com as 3 tabelas.
5. **Envs**: `OPENAI_API_KEY` (já existe), `VITRINE_PROVIDER` e
   `VITRINE_MODEL` (novas, documentar em `.env.example`; default
   `openai` / `gpt-image-1.5`). Sem key → provider `mock` + warning.
6. **Gate na conversa (Fase 1)**: implementar no pipeline determinístico do
   `ConversationOrchestrator` (padrão dos gates existentes), categoria de
   outbound `reply` (não é gated pelo channel safety), quota checada no gate.
   Job assíncrono via `DrizzleJobQueue` (padrão `send-message-job`).
7. **Testes por fase**: Fase 0 — prompt-builder puro, registry (cascata de
   resolução), provider com fetch mockado, quota; Fase 1 — gate (oferta,
   quota, falha → mensagem de contorno), re-hospedagem antes da geração.
8. **Fora de escopo** reafirmado: site da Linna continua como está; vertical
   odonto (norma CFO) é decisão de produto separada; extração para platform
   só com consumidor real.

## Regras do repo

- Branch da `main`; um PR por fase; `npm run verify`; `revisor-multitenant`
  obrigatório (schema + rota + pipeline de conversa no diff).
- Migração Drizzle em commit próprio; Vercel prod aplica no deploy.

## Prioridade

P3 no `docs/product/roadmap.md` — depois do go-live da Vitalli (P0) e do
painel owner (P1). A Fase 0 pode ser adiantada como "uau" de demo comercial
se surgir oportunidade de venda no segmento de cortinas/decoração.

## Esforço estimado

| Fase | Esforço |
|---|---|
| 0 — Core + playground | 2–3 dias |
| 1 — Conversa WhatsApp | 2–3 dias |
| 2 — Catálogo + métrica | 2 dias |
| 3 — Bench + tiers | 2 dias |
