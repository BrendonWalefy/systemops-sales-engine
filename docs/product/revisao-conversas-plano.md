# Plano — Revisão de Conversas pelo Cliente (feedback do shadow em rodadas)

**Status:** Aprovação pendente — pronto para execução por agentes
**Data:** 2026-07-14
**Relacionados:** ADR-002 (shadow study → validação), `docs/product/plano-excelencia-conversacional.md`, `docs/product/prospect-clinica-vitalli.md`
**Orquestração:** seção 9 define qual agente/modelo executa cada parte.

---

## 1. Problema e tese

A Vitalli desligou a IA ao vivo porque a primeira vez que o cliente viu o
comportamento real da assistente foi em produção, com leads reais (saudação
genérica, preço trocado). O estudo de setup (ADR-002, já em produção) valida
**fatos** — preços, políticas, tom — mas o cliente nunca vê **a conversa em
si** antes do go-live.

Tese: durante o shadow mode, enviar ao responsável da clínica um link com
**trechos reais de conversas** onde a IA (em shadow) responde ao lead,
renderizados como chat, com espaço de comentário **opcional** por trecho.
O cliente vê como a assistente fala, aponta o que ajustaria, e o feedback
vira insumo direto de personalização (playbook/config). Repetível em rodadas:
ajustou → nova rodada → aprovação explícita → go-live.

É a peça que faltou no caso Vitalli e a ferramenta do retorno dela ao shadow.

## 2. Decisão de produto: chat renderizado, NÃO prints

Debate original: prints (screenshots) dos trechos vs. layout leve de conversa.
**Decidido: layout renderizado.** Motivos, em ordem de peso:

1. **Não existe print possível.** Mensagens shadow têm `simulated=true` —
   nunca foram enviadas ao WhatsApp do lead. Não há tela real para
   fotografar; o print seria do nosso próprio admin (feio e confuso).
2. **Anonimização automática.** Texto passa por `anonymizeText()` já testado.
   Print exigiria redação manual de nome/foto/telefone de paciente em cada
   imagem (risco LGPD, erro humano, trabalho por cliente — não escala).
3. **Feedback ancorado.** Cada trecho é endereçável; comentário gruda no
   trecho certo e vira dado estruturado que alimenta o playbook. Imagem é
   beco sem saída de dado.
4. **Leve no celular.** O link chega por WhatsApp e abre no celular do dono
   da clínica. KBs de texto vs. MBs de imagem.
5. **Zero workflow manual.** Owner seleciona mensagens no painel; ninguém
   captura/recorta/faz upload de imagem por rodada.
6. O único argumento a favor do print — "cara de WhatsApp de verdade" — se
   resolve com bolhas estilo WhatsApp no layout (e ainda sinaliza "é assim
   que vai aparecer").

## 3. O que já existe e será reutilizado (não reinvestigar)

| Peça | Onde | Reuso |
|---|---|---|
| Padrão de página pública tokenizada | `src/app/(public)/validacao/[token]/` (page, actions, state-screen) | Clonar estrutura; ADR-002 previu explicitamente a reutilização do padrão |
| Token: gerar/hash/estado | `src/application/setup-study/access-token.ts` (+ testes `SetupStudyAccessToken.test.ts`) | Extrair para módulo compartilhado (Apêndice A) |
| Anonimização | `anonymizeText()` em `src/application/setup-study/build-corpus.ts` | Importar direto — não mover, não duplicar |
| Corpus shadow | `messages` (`author`: lead/clinic_user/agent/system; `simulated`; `deliveryFormat`; `mediaType`), `conversations.organizationId` | Fonte dos trechos |
| Padrão de card/section no owner | `setup-study-ui.tsx` + `setup-study-actions.ts` em `owner/clinics/[clinicId]/` | Mesmo padrão de montagem na página da clínica |
| Auth owner | `assertOwnerSession()` (ver `setup-study-actions.ts`) | Copiar padrão |
| Guarda TOCTOU nas actions públicas | `(public)/validacao/[token]/actions.ts` (WHERE com status) | Copiar padrão |

## 4. Modelo de dados

**Tabela nova `conversation_reviews`** (migração em commit próprio):

```
id uuid PK
organization_id uuid FK → organizations (cascade)
status conversation_review_status: draft | sent | answered | expired   (enum novo)
title text                     — ex.: "Rodada 1 — semana de 14/07"
excerpts jsonb                 — ConversationExcerpt[]
overall_comment text           — comentário geral do cliente na conclusão (opcional)
access_token_hash text
sent_at / answered_at / expires_at / created_at / updated_at timestamptz
índices: (organization_id, status) e (organization_id, created_at) — espelhar setup_studies
```

**Tipos em `src/domain/entities/conversation-review.ts`:**

```ts
type ExcerptRole = "lead" | "ia" | "clinica"; // clinica = resposta humana real (shadow)

interface ExcerptMessage {
  role: ExcerptRole;
  body: string;            // JÁ anonimizado no snapshot
  sentAt: string;          // ISO
  wasAudio?: boolean;      // deliveryFormat === "audio" → marcador 🎤 na UI
}

interface ConversationExcerpt {
  id: string;                       // uuid gerado na curadoria
  sourceConversationId: string;     // rastreabilidade interna; NUNCA vai à página pública
  context?: string;                 // 1 linha do owner: "Lead perguntou preço de lente"
  messages: ExcerptMessage[];       // snapshot congelado, ordenado por sentAt
  feedback?: {
    rating: "good" | "adjust";      // 👍 Ficou bom | ✏️ Eu ajustaria
    comment?: string;               // opcional, máx 1000
    suggestedReply?: string;        // "Como você responderia?" — opcional, máx 1000
    answeredAt: string;
  };
}
```

**Snapshot congelado**: o trecho copia as mensagens (anonimizadas) para o
jsonb no momento da curadoria. A página pública **nunca** consulta `messages`
— sem risco de tenant, e editar/apagar a conversa de origem não quebra o link.

## 5. Fluxo

1. **Owner cria rodada** (página da clínica): card "Revisão de conversas" →
   "Nova rodada" → cria `draft` com título.
2. **Owner cura trechos**: subpágina lista conversas do shadow com mensagens
   `simulated` (últimos 21 dias, máx 30 conversas); toca numa conversa, marca
   um intervalo de mensagens, adiciona como trecho (com linha de contexto
   opcional). Reordena/exclui trechos. Limites: 3–10 trechos por rodada,
   3–15 mensagens por trecho (validados no builder).
3. **Owner envia**: gera token (padrão API key — exibido uma única vez),
   status → `sent`, validade 7 dias. Owner manda o link por WhatsApp.
4. **Cliente abre `/conversas/<token>`** no celular: intro curta + trechos em
   bolhas de chat + feedback opcional por trecho + "Concluir revisão" (sempre
   habilitado; comentário geral opcional).
5. **Owner vê respostas** no mesmo card (ratings, comentários, sugestões de
   resposta) e aplica manualmente no playbook/config o que fizer sentido.
   Nova rodada quando quiser (rodadas anteriores ficam no histórico).

## 6. Página pública `/conversas/[token]` — UX e copy

- Rota: `src/app/(public)/conversas/[token]/{page.tsx,conversas-ui.tsx,actions.ts}`.
  Reusa o layout `(public)/layout.tsx` e o padrão de `StateScreen` (Apêndice B).
- Resolução **exclusivamente** por `sha256(token)`; estados: válido /
  expirado / já respondido / inválido — mesmas telas de estado da validação.
- **Bolhas estilo WhatsApp**, mobile-first, mesmo dark theme da página de
  validação (inline styles, `#a3e635` como accent — seguir `validacao-ui.tsx`):
  - `lead`: esquerda, cinza (`#1f1f23`), rótulo "Paciente".
  - `ia`: direita, verde-escuro (ex.: `rgba(163,230,53,0.12)` com borda),
    rótulo "Assistente IA".
  - `clinica`: direita, neutra com borda tracejada, rótulo "Equipe da clínica"
    (aparece só se o owner incluiu no trecho).
  - `wasAudio`: prefixo 🎤 e sufixo "(enviada como áudio)" no rótulo.
- Por trecho: linha de contexto do owner (se houver) → bolhas → barra de
  feedback: botões **[👍 Ficou bom] [✏️ Eu ajustaria]**; escolher "ajustaria"
  abre textarea "O que você mudaria? (opcional)" + campo "Como você
  responderia? (opcional)". Salvar por trecho (POST parcial idempotente,
  padrão `answerFinding`).
- **Concluir sempre disponível** (feedback é opcional por decisão de
  produto): botão sticky "Concluir revisão" + textarea "Algum comentário
  geral? (opcional)". Concluir → status `answered`.
- Copy pronta (não reescrever):
  - Título: `Veja como a assistente atende a {clinicName}`
  - Subtítulo: `Estes são trechos reais de conversas recentes — a assistente
    ainda está em observação e nada foi enviado aos seus pacientes. Onde
    estiver bom, toque em 👍. Onde você faria diferente, conte pra gente.
    Leva poucos minutos e deixa a assistente com a cara da sua clínica.`
  - Tela concluída: `Obrigado! Seus comentários já chegaram pra gente. Vamos
    ajustar a assistente e te mostrar a próxima rodada.`

## 7. Owner — curadoria e leitura

- Card na página da clínica (padrão `SetupStudyCard`): rodada atual + status
  + respostas quando `answered`; histórico compacto das rodadas anteriores.
- Subpágina `owner/clinics/[clinicId]/revisao-conversas/[reviewId]/` para a
  curadoria (picker). V1 do picker: lista de conversas elegíveis → expande
  mensagens → seleciona intervalo contíguo → "Adicionar trecho". Sem
  drag-and-drop; reordenar com ▲▼ simples.
- Actions em `conversation-review-actions.ts` (mesmo arquivo-padrão do
  setup study): `createReview`, `addExcerpt`, `removeExcerpt`,
  `reorderExcerpt`, `updateExcerptContext`, `sendReviewForFeedback`
  (token uma única vez), `expireReview`. Todas com `assertOwnerSession()` e
  escopo por `clinicId` da rota.
- O builder `src/application/conversation-review/build-excerpt.ts` recebe
  `(clinicId, conversationId, messageIds)` e: valida que a conversa pertence
  à clínica (guarda de tenant), carrega as mensagens, mapeia roles
  (`lead`→lead, `agent`→ia, `clinic_user`→clinica, `system`→descartada),
  anonimiza via `anonymizeText()` com o nome do lead, converte mídia em
  placeholder (Apêndice C) e devolve o `ConversationExcerpt` congelado.

## 8. Entregas (PRs), testes e verificação

PRs baseados na `main` (fluxo vigente; ver memória do projeto — develop está
defasada). `npm run verify` verde antes de cada PR. Migração drizzle em
commit próprio (`npm run db:generate`; `npx tsx scripts/check-drizzle-meta.ts
--fix` se `db:check` reclamar). **`revisor-multitenant` obrigatório nos dois
PRs** (superfície pública nova + queries por tenant).

### PR 1 — `feat/conversation-review-core`
Migração + enum + tipos de domínio + extração do token helper compartilhado
(Apêndice A) + `build-excerpt.ts` + actions owner + UI de curadoria + card na
página da clínica. Sem página pública.

Testes (padrão dos `SetupStudy*.test.ts`):
- `build-excerpt`: conversa de outra clínica → erro; anonimização aplicada
  no snapshot; roles mapeados; `system` descartada; mídia vira placeholder;
  ordem por `sentAt`; limites de tamanho respeitados.
- Token compartilhado: os testes existentes de `SetupStudyAccessToken`
  continuam verdes sem alteração (re-export preserva contrato).

### PR 2 — `feat/conversation-review-public-page`
Página pública `/conversas/[token]` + actions públicas + estados + passada de
polimento visual (designer-ux) na mesma branch antes de abrir o PR.

Testes:
- Actions públicas: token inválido/expirado/já respondido; feedback parcial
  idempotente; `rating` fora do enum rejeitado; limites de 1000 chars;
  concluir sem nenhum feedback é permitido; WHERE com guarda de status
  (TOCTOU, copiar padrão de `validacao/[token]/actions.ts`).

### PR 3 (opcional, v1.5) — leitura enriquecida no owner
"Copiar para playbook.notes" por sugestão de resposta (append manual, um
clique). Só depois das duas primeiras rodarem com um cliente real.

## 9. Orquestração de agentes e modelos (economia de tokens)

Princípio: **Fable é o cérebro caro — entra no plano, nos checkpoints e nas
dúvidas; nunca digita UI.** Sonnet executa; revisões são sobre diffs, não
sobre transcripts.

| Etapa | Executor | Modelo | Fable entra? |
|---|---|---|---|
| Plano e decisões de arquitetura | Fable | — | Feito (este doc) |
| PR 1 (core) | agente `general-purpose` | **sonnet** | Checkpoint 1: revisa o `git diff` antes do push (migração + tenant guard do builder) |
| PR 2 (página pública) | agente `general-purpose` | **sonnet** | Checkpoint 2: revisa o diff da superfície pública (token, estados, actions) |
| Polimento visual do PR 2 | agente `designer-ux` | default do agente | Não |
| Auditoria de cada PR | agente `revisor-multitenant` | default do agente | Lê os findings e decide o que bloqueia merge |
| Dúvidas de execução | — | — | Executor reporta a dúvida ao orquestrador; Fable responde em parágrafos via SendMessage (não abrir sessão nova) |

Regras de economia (obrigatórias para os executores):
1. Insumos do executor: **este doc + ADR-002 + os arquivos da tabela da
   seção 3**. Proibido varrer o repo além disso — o custo do plano já pagou
   essa exploração.
2. Decisão do Apêndice não se reabre. Ambiguidade nova → perguntar ao
   orquestrador antes de improvisar (uma pergunta barata evita um PR refeito).
3. Copy da seção 6 é final — não gastar tokens reescrevendo.
4. Haiku só para tarefas mecânicas fora do caminho crítico (ex.: atualizar
   índices de docs). Nenhum código de superfície pública em haiku.
5. Fable revisa **diffs**; não pedir a ele leitura de transcript de agente.

## 10. Segurança, multi-tenant e LGPD

- Página pública resolve **apenas** por hash do token; `clinicId`,
  `reviewId` e `sourceConversationId` nunca trafegam em URL ou payload
  público.
- Token 32 bytes base64url, só o hash no banco, exibido uma única vez.
  Rate limit dispensado na v1 — mesma justificativa registrada no ADR-002
  (256 bits de entropia); repetir o comentário na rota.
- Snapshot anonimizado na curadoria (nome → `[PACIENTE]`, 8+ dígitos →
  `[TELEFONE]` conforme `anonymizeText`); a página pública nunca vê dado
  bruto nem mídia de paciente.
- Actions owner sempre escopadas pelo `clinicId` da rota + status esperado
  no WHERE.

## 11. Fora de escopo v1

- Comentário por mensagem individual (v1 é por trecho).
- Sugestão automática de trechos por LLM (v2 — candidato: `engenheiro-conversa`
  ranqueia trechos com `simulated=true` mais "arriscados"; hoje a curadoria
  manual do owner é parte do valor).
- Aplicação automática do feedback em playbook/config (v1.5 é um append
  manual em `playbook.notes`; nada de parse de texto livre).
- Comparação lado a lado IA×humano na página do cliente (já é subproduto
  previsto no ADR-002 para uso interno; expor ao cliente confunde).
- Rodadas agendadas/cron, prints/imagens, canais além do link.

---

## Apêndice — decisões fechadas (não reabrir)

**A. Token helper compartilhado.** Criar
`src/application/public-link/access-token.ts` com `generateAccessToken`,
`hashAccessToken` e `resolvePublicDocState({ status, expiresAt }, now)`
(generalização de `resolveStudyState` — aceita qualquer doc com esses
campos). `src/application/setup-study/access-token.ts` vira re-export do
módulo novo (imports e testes existentes intocados). Hash e formato do token
não mudam em nada.

**B. StateScreen compartilhado.** Mover `state-screen.tsx` para
`src/app/(public)/state-screen.tsx`; `validacao/[token]/state-screen.tsx`
vira re-export (ou atualizar os 2 imports — o que for menor).

**C. Mídia e áudio.** Mensagem com `mediaType` vira bolha placeholder:
`[foto] 📷` / `[vídeo] 🎬` / `[áudio] 🎤` / `[documento] 📄` + `body` se
houver. Nunca embutir `mediaUrl` na página pública. `deliveryFormat=audio`
com corpo de texto → renderiza o texto com marcador `wasAudio`.

**D. Feedback opcional de verdade.** Concluir não exige nenhum trecho
respondido. O sinal mínimo de cada trecho é 1 toque (👍/✏️). `rating` só
aceita `"good" | "adjust"`; textos limitados a 1000 chars (mesmo limite da
validação).

**E. Enum próprio.** `conversation_review_status` novo com
`draft | sent | answered | expired` — não reutilizar `setupStudyStatusEnum`
(tem `applied`, que não existe aqui).

**F. Rota pública própria.** `/conversas/[token]` — não estender
`/validacao/[token]` com abas/discriminador. Dois fluxos, duas rotas, os dois
clones do mesmo padrão.

**G. Sem live-query na página pública.** Trechos vêm 100% do jsonb
`excerpts`. Se a conversa de origem mudar depois, o trecho não muda — é um
retrato do momento da curadoria (feature, não bug).

**H. Validade e limites.** Link expira em 7 dias (constante própria,
espelhando `VALIDATION_LINK_TTL_DAYS`). 3–10 trechos por rodada, 3–15
mensagens por trecho, contexto do owner máx. 140 chars.

**I. Nomes client-facing.** O cliente vê "Revisão de conversas" e os rótulos
"Paciente" / "Assistente IA" / "Equipe da clínica". Nunca expor "shadow",
"simulated" ou termos técnicos.

## Esforço estimado

| Entrega | Tamanho |
|---|---|
| PR 1 — core + curadoria | ~1 sessão de agente (M) |
| PR 2 — página pública + polish | ~1 sessão de agente (M) |
| PR 3 — v1.5 opcional | S |

Piloto natural: rodada 1 com a Vitalli no retorno ao shadow (pós
post-mortem), e rodada 1 com a NC Beauty antes do go-live dela.
