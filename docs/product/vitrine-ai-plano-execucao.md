# Vitrine AI — Plano de Execução do Módulo

Plano de execução para transformar o MVP validado no repo da Linna Cortinas
(`site-cortinas/dev/linnacortinas`) em módulo do SystemOps, consumível pelo
sales-engine, com providers de imagem plugáveis para bench e troca de modelo
sem refatoração.

Data: 2026-07-06.
Origem: `site-cortinas/dev/linnacortinas/src/lib/api/staging.functions.ts` e
`src/components/site/BudgetForm.tsx`.

## O que é a Vitrine AI

Simulador visual de produto no ambiente real do cliente: o lead envia uma foto
do próprio ambiente, escolhe produto e variação (ex: cortina Wave off-white), e
a IA gera a foto do ambiente com o produto instalado, preservando 100% da cena
original. Reduz fricção de decisão, funciona como "uau" de demo e qualifica o
lead.

## Decisões já tomadas (não rediscutir)

1. **Onde mora: dentro do `systemops-sales-engine`**, como módulo com
   fronteiras limpas (port + adapters, mesmo padrão de
   `src/application/ports/channel-adapter.ts`). Não criar repo novo.
   Justificativa: toda a tubulação necessária já existe aqui —
   - Recebe imagem do lead: `zapi-channel-adapter.ts` → `resolveZApiMedia`
     já extrai `image.imageUrl` do webhook.
   - Envia imagem ao lead: `sendZApiMediaMessage` com `send-image` + caption.
   - Storage permanente: `VercelBlobStorageGateway` (URLs de mídia do
     WhatsApp expiram em ~48h; URLs da OpenAI em ~60min — tudo precisa ser
     re-hospedado, e o padrão já existe em `lead-photo-service.ts`).
   - Multi-tenant, outbox, dashboard e billing futuros já vivem aqui.

   O `systemops-platform` é o destino de longo prazo. Para a extração futura
   ser mecânica, o core do módulo (ports, tipos, prompt builder) **não pode
   importar nada do domínio de clínica** — só recebe IDs e dados genéricos.

2. **Provider inicial: OpenAI `gpt-image-1.5`** via `/v1/images/edits`,
   `quality: high` — é o que está validado e funcionando muito bem na Linna.
   O bench com outros modelos (Gemini Flash Image etc.) vem depois, na Fase 3,
   sobre a abstração de provider construída desde o dia 1.

3. **Plug-and-play de modelos é requisito de arquitetura, não feature.**
   Trocar de provider/modelo = 1 arquivo novo + 1 entrada no registry + config.
   Zero mudança no core.

4. **O sistema decide, a LLM verbaliza.** A geração de imagem é uma ação
   determinística disparada por gate do sistema (lead enviou foto dentro do
   fluxo de vitrine + quota disponível), nunca decisão livre da LLM.

## Arquitetura do módulo

### Layout de código

```
src/core/vitrine/
  ports/image-staging-provider.ts    # port + tipos (segment-agnostic)
  prompt-builder.ts                  # template que consome item de catálogo
  staging-service.ts                 # orquestra: valida, gera, persiste, metra
src/infrastructure/adapters/vitrine/
  openai-image-provider.ts           # gpt-image-1.5 (port do código Linna)
  gemini-image-provider.ts           # Fase 3
  mock-image-provider.ts             # dev/fallback: devolve a própria foto
  provider-registry.ts               # resolve provider por config
```

### Port (contrato central)

```ts
export type StagingRequest = {
  sourceImage: { bytes: ArrayBuffer; mimeType: string };
  prompt: string;               // já montado pelo prompt-builder
  quality: "standard" | "high";
};

export type StagingResult = {
  imageBytes: ArrayBuffer;      // provider SEMPRE devolve bytes, nunca URL
  mimeType: string;
  provider: string;             // ex: "openai"
  model: string;                // ex: "gpt-image-1.5"
  latencyMs: number;
  costEstimateUsd: number | null;
};

export type ImageStagingProvider = {
  readonly id: string;
  generate(request: StagingRequest): Promise<StagingResult>;
};
```

Regras do port:
- Provider devolve **bytes**, nunca URL — quem persiste é o `staging-service`
  (no Vercel Blob), pois URLs de provider expiram.
- Provider não conhece catálogo, tenant nem lead. Só imagem + prompt.
- Erro do provider lança exceção tipada; o service decide fallback.

### Registry e configuração plugável

```ts
// provider-registry.ts
const providers = { openai: OpenAiImageProvider, gemini: ..., mock: ... };
export function resolveStagingProvider(cfg: VitrineConfig): ImageStagingProvider;
```

Resolução em cascata: config do tenant (coluna em `clinic_settings` ou
equivalente) → env `VITRINE_PROVIDER`/`VITRINE_MODEL` → default `openai`.
Sem `OPENAI_API_KEY` → `mock` com log de warning (mesmo comportamento
gracioso do MVP da Linna).

### Prompt builder

Portar `buildStagingPrompt` da Linna, com uma mudança estrutural: as
descrições físicas de produto (`MODELO_DESCRIPTIONS`) e de cor/tecido
(`COR_DESCRIPTIONS`) saem de constantes hardcoded e viram **dados do
catálogo** (ver schema). O template em si (regra absoluta de preservação,
instruções de montagem, sombras, fotorrealismo) permanece — é o que já foi
iterado e validado.

### Schema (Drizzle, migração nova)

```
vitrine_catalog_items
  id, clinic_id (tenant), name, physical_description (text),
  active, created_at, updated_at

vitrine_catalog_variants
  id, item_id, name (ex: "Off-white"), fabric_description (text), active

vitrine_generations
  id, clinic_id, lead_id (nullable), conversation_id (nullable),
  item_id, variant_id,
  source_image_url (blob), result_image_url (blob, nullable),
  provider, model, quality, status (pending|succeeded|failed),
  error (nullable), latency_ms, cost_estimate_usd,
  created_at, completed_at
```

Toda query filtra por `clinic_id` — guardrail multi-tenant inegociável.
`vitrine_generations` é a tabela de metering: billing por plano na Fase 3
lê daqui, então custo e modelo são registrados desde a primeira geração.

### Guardrails de custo e abuso (desde a Fase 0)

- Quota por lead: máx. 3 gerações/dia (configurável por tenant).
- Quota por tenant: cap diário (default 50) — geração high custa
  ~US$ 0,19–0,25; sem cap, um loop de abuso queima dinheiro real.
- Correção herdada do MVP: **não espremer a foto em 1024×1024**. Manter a
  proporção e mapear para o tamanho suportado mais próximo
  (1536×1024 / 1024×1536 / 1024×1024, via `size` explícito) — o resize
  quadrado do BudgetForm distorce a geometria que o prompt manda preservar.

## Fases

### Fase 0 — Core do módulo + playground interno (o "uau" controlado)

Objetivo: gerar imagem real em produção, pelo dashboard, antes de qualquer
cliente ver.

1. Criar port, tipos, prompt-builder e `staging-service` em `src/core/vitrine/`.
2. Portar o provider OpenAI da Linna (incl. detecção de MIME e fallback mock).
3. Migração das 3 tabelas + seed de catálogo de exemplo (os 4 modelos e 4
   cores da Linna servem como seed de validação).
4. Página interna no dashboard do owner: upload de foto, escolha de
   item/variação, botão gerar, exibição lado a lado (antes/depois), com
   latência e custo estimado visíveis.
5. Persistir origem e resultado no Vercel Blob via `VercelBlobStorageGateway`.

Critério de aceite: gerar 10 imagens reais no playground com qualidade
equivalente à do MVP da Linna, todas registradas em `vitrine_generations`
com custo e latência.

### Fase 1 — Integração na conversa WhatsApp (o "uau" de demo)

Objetivo: na demo comercial, o recepcionista IA oferece a simulação, o lead
manda a foto e recebe o resultado na própria conversa.

1. Fluxo determinístico no pipeline de conversa:
   - Gate de oferta: sistema decide quando oferecer ("quer ver como fica no
     seu ambiente? me manda uma foto") conforme playbook do segmento.
   - Lead envia imagem → webhook entrega `mediaUrl` → re-hospedar no Blob
     imediatamente (URL expira em ~48h) → criar `vitrine_generation` pending.
   - Geração é **assíncrona** (high quality leva 30–60s): enviar mensagem de
     espera imediata ("preparando sua simulação, chega em instantes ✨") e
     entregar o resultado via outbox quando concluir — a conversa nunca trava.
   - Resultado sai como `send-image` com caption curta de condução de funil.
2. Falha de geração → mensagem honesta de contorno + notificação interna;
   nunca silêncio, nunca travar o funil.
3. Quota por lead aplicada no gate (não na LLM).

Critério de aceite: demo de ponta a ponta no WhatsApp real — foto entra,
simulação volta na conversa em < 90s, tudo registrado e vinculado ao lead.

### Fase 2 — Configuração por tenant + valor visível no funil

1. CRUD de catálogo no dashboard (itens, variações, descrições físicas) +
   toggle liga/desliga da Vitrine por tenant.
2. Galeria de gerações na página do lead (o vendedor reaproveita a imagem
   no follow-up).
3. Métrica no dashboard: gerações → orçamentos → conversão. É essa métrica
   que transforma a Vitrine de "efeito uau" em prova de valor vendável.

### Fase 3 — Bench de modelos + tiers por plano

1. Harness de bench: script que roda um conjunto fixo de 5–10 fotos reais ×
   catálogo × N providers, grava tudo em `vitrine_generations` (tag de
   bench) e gera página de comparação lado a lado com custo/latência.
2. Candidatos: `gpt-image-1.5` (high e standard), Gemini Flash Image
   (~US$ 0,04/img, forte em edição com preservação estrutural), e o que
   mais surgir — adicionar candidato = 1 adapter novo.
3. Decisão de tiers: modelo econômico × premium por plano, quotas mensais
   por plano, pacote adicional de gerações como add-on. Precificação parte
   do metering real acumulado nas fases 0–2.

## O que fica fora (por enquanto)

- Migrar o site da Linna para consumir o módulo — o MVP dela continua como
  está; vira consumidor da API do módulo quando houver API pública (pós
  Fase 2, ou na extração para o platform).
- Vertical odontologia (simulação de sorriso/harmonização): esbarra em
  norma do CFO sobre promessa de resultado clínico. Se entrar um dia, é como
  "visualização ilustrativa" com disclaimer — decisão de produto separada.
- Extração para `systemops-platform` — só quando o platform tiver deploy e
  primeiro consumidor real. A disciplina de fronteira (core sem imports de
  domínio de clínica) mantém esse caminho barato.

## Processo (padrão do repo)

- Branch a partir de `main` (develop está defasada); PR para `main` via
  `/prep-pr`; `revisor-multitenant` antes do PR (o diff toca schema, rotas e
  pipeline de conversa — gatilho obrigatório).
- Migração Drizzle no padrão do repo; Vercel prod aplica sozinho no deploy.
- Uma fase por PR. Fase 0 e Fase 1 são PRs separados.
