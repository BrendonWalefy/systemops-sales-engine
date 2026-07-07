# Biblioteca de Mídia — Plano de Execução

Promover a "Biblioteca de mídia" de seção embutida no editor de playbook para
um recurso de primeira classe da clínica: uma biblioteca única (vídeos, fotos
e, depois, documentos), organizável por pasta, com limite de 10 itens por
clínica, consumida via picker por todas as telas que hoje duplicam UI de mídia.

Data: 2026-07-07.
Status: planejado (executar após ADR-002 / go-live Vitalli, salvo decisão contrária).

## ⚠️ Restrição inegociável: Ximendes não pode quebrar

A **Ximendes Odontologia** (slug `ximendes`) é clínica real em produção com
vídeos em uso ativo: a biblioteca do playbook ativo alimenta o system prompt da
IA (`[MEDIA:id]`) e os `pipeline_steps` dos tratamentos referenciam esses
vídeos por `mediaId`. Qualquer quebra = vídeo **silenciosamente omitido ao
lead** em conversa real (ver log de erro em
`src/core/pipeline/ConversationOrchestrator.ts` → `resolveOutboundParts`).

**Invariantes desta migração:**

1. **IDs preservados.** Todo item da biblioteca da Ximendes migra para a nova
   tabela mantendo o MESMO `id` (uuid) do jsonb atual. Nenhuma referência em
   `treatments.pipeline_steps` ou em versão de playbook precisa ser reescrita.
2. **URLs intocadas.** Os blobs no Vercel Blob não são movidos nem re-uploadados.
3. **Contrato de runtime idêntico.** `getEditorialConfig` continua entregando
   `mediaLibrary: { id, title, url, type }[]` para ResponseComposer,
   ConversationOrchestrator e simulador — só muda a fonte (tabela em vez de
   jsonb). Zero mudança em `resolveOutboundParts`, no marcador `[MEDIA:id]` e
   no prompt.
4. **Backfill dentro da migração SQL** (idempotente), porque o deploy da
   Vercel roda migração automaticamente: nunca existe janela em que o schema
   novo está no ar sem os dados da Ximendes populados.
5. **Fallback temporário.** Por 1 release, se a junção com `media_assets`
   vier vazia mas o jsonb legado tiver itens, o read path usa o legado e loga
   `warn` — cinto e suspensório até a contração (Fase 4).

**Checklist de verificação Ximendes (obrigatório em cada fase):**

- [ ] Pré-deploy: rodar `scripts/dump-media-refs.ts` (criar na Fase 1) — lista
      ids/urls da biblioteca ativa da Ximendes + todos os `mediaId` em
      `pipeline_steps` de seus tratamentos.
- [ ] Pós-deploy: rodar de novo — todo `mediaId` referenciado resolve em
      `media_assets` com URL byte-idêntica.
- [ ] Logs de produção sem NENHUMA ocorrência nova de
      `"mediaId não encontrado na biblioteca"` (erro já instrumentado no
      orchestrator — é o alarme exato deste modo de falha).
- [ ] Simulador (`/api/playbook/simulate`) da Ximendes: pedir "vídeo das
      lentes" e confirmar que a mídia resolve e anexa.
- [ ] Testes `PlaybookComposition.test.ts` e `XimendesConversationPatterns.test.ts`
      verdes sem alteração de expectativa.

Bônus: esta migração **elimina** as causas (1) e (2) do modo de falha
documentado no orchestrator — id de mídia deixa de ser versionado com o
playbook e passa a ser estável no nível da clínica.

## ⚠️ Isolamento — mídia NUNCA vaza (requisito duro, não convenção)

Duas dimensões de isolamento, ambas com enforcement determinístico em camadas
(write → read → send). Regra do projeto se aplica: **o sistema decide, a LLM
verbaliza** — nenhuma camada de isolamento pode depender de instrução de
prompt.

### A. Entre organizações (tenant)

| Camada | Enforcement |
|---|---|
| **Write — upload** | `/api/media/upload` resolve `clinicId` da SESSÃO no servidor (nunca de payload do cliente) e grava a linha em `media_assets` na mesma operação. |
| **Write — seleção** | Ao salvar `media_asset_ids` do playbook ou bloco `media` de pipeline, o server action valida que CADA id pertence à clínica da sessão; id estranho → **rejeita com erro** (fail-loud), nunca filtra em silêncio. |
| **Read — editorial** | Join `media_asset_ids` × `media_assets` sempre com `AND media_assets.organization_id = <clinicId do playbook>`. Id de outro tenant que escape para a seleção (bug, migração) é derrubado pelo join (fail-closed). |
| **Read — picker/biblioteca** | Toda listagem `WHERE organization_id = session.clinicId`, em repositório Drizzle (guardrail AGENTS.md — nada de query solta em componente). |
| **Send — última linha** | `resolveOutboundParts` já resolve só contra a biblioteca da própria clínica: id alheio não resolve → mídia omitida + erro logado. Comportamento preservado. |
| **Backfill** | Colisão de id entre clínicas é vetor de vazamento direto (demo pode ter sido semeada com objetos da Ximendes). Regra: Ximendes fica com o id; a outra clínica re-minta; a migração **falha explicitamente** se não souber resolver. Pós-backfill: asserção de que nenhum asset é referenciado por mais de uma clínica. |
| **Testes** | Suíte multi-tenant obrigatória: clínica A não lista, não seleciona e não resolve assets da B; salvar seleção com id da B retorna erro. |

Risco residual **pré-existente** (não introduzido por este plano): blobs são
`access: "public"` no Vercel Blob — quem tiver a URL exata acessa (sufixo
aleatório, não enumerável). URL assinada é evolução futura, fora de escopo.

### B. Entre procedimentos

Hoje o caminho determinístico já é isolado (`pipeline_steps` de um tratamento
só envia o `mediaId` configurado nele), mas o caminho livre da IA depende de
instrução de prompt ("envie vídeos relacionados a X") — julgamento da LLM.
Isso vira decisão de sistema:

1. **`media_assets.treatmentId`** (FK `treatments`, **nullable**; null =
   "mídia geral da clínica"). Na biblioteca, campo opcional "Procedimento".
2. **Filtro na composição (prompt):** quando o pipeline identificou o
   tratamento da conversa (`identifiedTreatment`), a lista `BIBLIOTECA DE
   MÍDIA` injetada no system prompt contém APENAS assets daquele tratamento +
   gerais. Mídia de outro procedimento **nem aparece como opção** para a LLM.
   Sem tratamento identificado: lista completa da seleção do playbook
   (comportamento atual).
3. **Gate no envio (garantia dura):** em `resolveOutboundParts`, item com
   `treatmentId` divergente do tratamento ativo da conversa é **bloqueado +
   erro logado** (mesmo padrão do "mediaId não encontrado"). Mesmo que a LLM
   alucine um token válido de outro procedimento, o sistema não envia.
4. **Picker do pipeline:** ao editar o pipeline do tratamento X, o picker só
   oferece mídias de X + gerais (guarda no write).
5. **Backfill neutro:** todo asset migrado nasce `treatmentId = null` (geral)
   → comportamento idêntico ao de hoje, zero regressão para a Ximendes. A
   associação a procedimento é opt-in, feita depois, clínica a clínica.

## Por que mudar (sintomas no código de hoje)

- `media_library` é jsonb em `playbook_versions` (`schema.ts` ~L983): a mídia
  é "congelada" por versão, mas `treatments.pipeline_steps` referencia
  `mediaId` cross-módulo → nova versão de playbook pode órfanizar blocos de
  pipeline sem aviso.
- Upload (`/api/media/upload`) grava no Vercel Blob **sem registro de dono**:
  sem atribuição multi-tenant, sem contagem, sem limpeza possível de órfãos.
- UI duplicada: editor de playbook (upload+lista), wizard de onboarding
  (seleção), editor de pipeline (select por id) — três implementações.
- Custo de prompt: cada título entra no system prompt
  (`ResponseComposer.buildSystemPrompt`); sem teto, mais itens = mais tokens e
  mais erro de seleção da IA.

## Decisões (não rediscutir)

1. **Tabela `media_assets`, escopo clínica.** Fonte única da mídia. O playbook
   passa a **selecionar** (curadoria do prompt continua nele); a posse do
   arquivo é da clínica.
2. **Pasta = coluna `folder` (text, nullable).** Com teto de 10 itens,
   hierarquia real de pastas é over-engineering. Agrupamento visual simples.
3. **Limite de 10 por clínica, validado no servidor** (contagem na inserção,
   erro amigável). UI mostra `n/10`. O teto protege custo de storage; a
   curadoria do prompt é a seleção por playbook (subconjunto ≤ 10).
4. **Seleção do playbook = `media_asset_ids: jsonb string[]`** em
   `playbook_versions`. Continua versionada (duplicar/publicar clona a
   seleção naturalmente), mas aponta para assets estáveis.
5. **Exclusão com guarda, nunca cascata.** Deletar asset exige zero
   referências (varre `media_asset_ids` de todas as versões + `pipeline_steps`
   de todos os tratamentos da clínica). UI mostra "em uso por: Playbook v2,
   Pipeline Lentes". Delete permitido apaga o blob via
   `VercelBlobStorageGateway`.
6. **Expand → migrate → contract.** Coluna legada `media_library` só é
   removida na Fase 4, após validação em produção.
7. **Documentos (PDF) são fase própria (Fase 3),** não bloqueiam a migração.
   O adapter Z-API já suporta `send-document`; falta ampliar `ALLOWED_TYPES`
   do upload e os tipos `"video" | "image"` fim-a-fim.
8. **Isolamento é enforcement em código, nunca instrução de prompt.** Tenant:
   validação no write + join filtrado no read + resolução local no send.
   Procedimento: `treatmentId` opcional no asset + filtro na composição +
   gate determinístico no envio (seção "Isolamento" acima).
9. **Execução cirúrgica.** Diff mínimo por PR, zero refactor oportunista,
   contratos de runtime intocados, cada fase verificável de forma independente
   com o checklist Ximendes. Nenhum comportamento atual muda sem estar listado
   neste plano.

## Schema

```ts
// media_assets
{
  id: uuid PK,                 // backfill PRESERVA o id do jsonb legado
  clinicId: uuid FK organizations (not null),
  treatmentId: uuid FK treatments,  // null = mídia geral; isolamento por procedimento
  title: text (not null),
  url: text (not null),        // Vercel Blob
  type: text $type<"video" | "image" | "document"> (not null),
  mimeType: text,
  sizeBytes: integer,
  folder: text,                // null = raiz
  createdAt / updatedAt: timestamptz
}
// índice: (organization_id) — listagem por clínica
// invariante: treatmentId, quando presente, referencia treatment da MESMA
// organization (validado no server action; treatments já é clinic-scoped)
```

```ts
// playbook_versions: + media_asset_ids jsonb $type<string[]> default []
// (media_library legado permanece até a Fase 4)
```

### Backfill (dentro da migração SQL, idempotente)

Para cada clínica, expandir `jsonb_array_elements` do `media_library` de TODAS
as versões (ativa primeiro — título/URL dela vence), inserir em `media_assets`
com `ON CONFLICT (id) DO NOTHING`, e setar `media_asset_ids` de cada versão com
os ids que o jsonb dela continha.

**Colisão de id entre clínicas:** a clínica demo pode ter sido semeada com os
mesmos objetos da Ximendes (fallback antigo do `seed-demo-clinic.ts`). Regra:
**a Ximendes SEMPRE fica com o id original** (cliente real > demo). Para a
outra clínica, mintar novo uuid e reescrever as referências dela
(`media_asset_ids` + `pipeline_steps`) — ou simplesmente re-seedar a demo, que
tem script próprio. A migração detecta a colisão e falha explicitamente se não
souber resolver, nunca resolve em silêncio pro lado errado.

## Contratos que NÃO mudam

| Consumidor | Contrato | Mudança |
|---|---|---|
| `ResponseComposer` | `clinic.mediaLibrary: {id,title,type}[]` → títulos + `[MEDIA:id]` no prompt | nenhuma (Fase 3 amplia type) |
| `ConversationOrchestrator.resolveOutboundParts` | resolve `[MEDIA:id]` e `pipeline_steps` `{kind:"media", mediaId}` → URL | nenhuma |
| `/api/playbook/simulate` | recebe `mediaLibrary` via editorial config | nenhuma |
| `getEditorialConfig` | **output** `mediaLibrary: {id,title,url,type}[]` | só a **fonte**: join `media_asset_ids` × `media_assets` (fallback legado por 1 release) |

## UI

1. **Página `/app/settings/biblioteca`** — grid de assets com filtro por
   pasta, upload (reusa `/api/media/upload`, que passa a gravar a linha em
   `media_assets` com `clinicId` da sessão), renomear, mover de pasta,
   excluir (com guarda "em uso"), contador `n/10`.
2. **Componente `MediaPicker`** (compartilhado) — modal de seleção com
   thumbnails/pastas; suporta `multiple` e filtro por tipo. Upload inline
   dentro do picker (cai na biblioteca).
3. **Consumidores:**
   - **Editor de playbook** (seção 4 do print): vira "Mídias que a IA pode
     enviar" — lista selecionada + botão "Selecionar da biblioteca"
     (`MediaPicker`). Upload direto some da tela (existe dentro do picker).
   - **Editor de pipeline**: bloco `media` troca o `<select>` atual pelo
     `MediaPicker` (single).
   - **Wizard de onboarding**: passa a listar/selecionar de `media_assets`
     via picker (hoje só seleciona da lista do playbook).

## Fases / PRs

| PR | Escopo | Ximendes | Esforço |
|---|---|---|---|
| **1 — Fundação** | tabela (já com `treatmentId` nullable — evita 2ª migração) + migração com backfill in-SQL (ids preservados, tudo `treatmentId=null`), `media_asset_ids`, read path do `getEditorialConfig` com fallback+warn, asserção pós-backfill de unicidade de tenant por asset, `scripts/dump-media-refs.ts`, testes de equivalência (mesma config editorial antes/depois) + suíte de isolamento tenant | checklist completo pré/pós-deploy | 1–1,5 dia |
| **2 — Biblioteca + picker + gates** | página `/app/settings/biblioteca`, `MediaPicker`, upload grava em `media_assets` (clinicId da sessão), limite 10 server-side, guarda de exclusão, validação de posse no write (seleção do playbook e pipeline), filtro por tratamento na composição do prompt, gate de tratamento em `resolveOutboundParts`, 3 consumidores migrados | sem mudança de runtime p/ assets `treatmentId=null`; checklist de logs | 2–2,5 dias |
| **3 — Documentos** | PDF em `ALLOWED_TYPES`, `type: "document"` fim-a-fim (composer rotula "documento", orchestrator, adapter já pronto), teste no `ZApiChannelAdapter.test.ts` | idem | 0,5–1 dia |
| **4 — Contração** | remove `media_library` legado + fallback; atualiza `seed-demo-clinic.ts` (fallback Ximendes lê de `media_assets`) e `clinic-blueprint` | só após ≥1 semana de produção limpa nos logs | 0,5 dia |

Cada PR passa pelo `revisor-multitenant` (toca repositórios Drizzle, migração
e orquestração de conversa — gatilhos do AGENTS.md) e pelo fluxo do
`change-control.md`. PRs baseados em `main`.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Migração roda no deploy Vercel e falha no meio | backfill idempotente (`ON CONFLICT DO NOTHING`), transacional; testar num branch database do Neon antes |
| Id órfão pós-migração (referência sem asset) | `dump-media-refs.ts` pré/pós + erro já logado no orchestrator como alarme; fallback legado segura 1 release |
| **Vazamento entre tenants** | 3 camadas independentes (write valida posse, read filtra no join, send resolve local) + asserção pós-backfill + suíte de testes multi-tenant; qualquer camada sozinha já bloqueia |
| **Mídia de um procedimento enviada em outro** | `treatmentId` no asset + filtro na composição + gate determinístico em `resolveOutboundParts`; instrução de prompt deixa de ser a única barreira |
| Gate de tratamento bloquear mídia legítima (falso positivo) | backfill nasce 100% `treatmentId=null` (sem gate ativo); associação é opt-in e reversível; bloqueio sempre loga erro com contexto p/ diagnóstico |
| Editar asset muda comportamento de versões antigas do playbook | trade-off aceito e desejado (fonte única); guarda de exclusão evita o caso destrutivo |
| Demo clinic com ids colididos | regra "Ximendes vence" + re-seed da demo |
| Prompt crescer com biblioteca cheia | seleção por playbook continua sendo o que entra no prompt, não a biblioteca inteira |

## Prioridade sugerida

P1/P2 — depois do Setup Study (ADR-002) e do go-live da Vitalli (~20/07).
A Fase 1 pode ser adiantada se o picker virar necessidade de demo/venda; ela é
invisível ao usuário e reduz risco em produção por si só (ids estáveis).
