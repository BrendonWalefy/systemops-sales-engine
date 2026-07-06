# ADR-002: Estudo do Shadow Mode → Validação do Cliente → Diff de Config

**Status:** Aprovado — implementação pendente
**Data:** 2026-07-06
**Contexto:** Automatizar o setup de clínicas aprendendo com o atendimento humano real capturado durante o shadow mode

---

## Contexto

O setup de uma clínica nova é manual e o owner se sente perdido sobre o que
coletar (caso real: Clínica Vitalli, 1º cliente). O produto foi definido em
`docs/product/ficha-setup-clinica.md` (Parte 2, item 4b); este ADR define a
arquitetura para virar feature.

A tese: durante o shadow mode, o sistema já captura o atendimento humano
completo — o que a clínica *de fato* responde sobre preço, políticas, tom e
horários. Em vez de questionário, extraímos candidatos a configuração das
conversas reais, o responsável da clínica valida num documento simples
(✓ confirmo / ✏️ corrigir), e o owner aplica as mudanças com revisão.

### O que já existe (não reinvestigar)

| Peça | Onde | O que dá pra reusar |
|---|---|---|
| Corpus de conversas | `messages` com `author` enum (`lead`, `clinic_user`, `agent`, `system`) | Resposta humana real = `clinic_user` (gravada pelo webhook Z-API via "notificar enviadas por mim", `src/app/api/whatsapp/zapi/route.ts` → `saveOperatorOutbound`) |
| Shadow mode | `send-message-job.ts` (~linha 431, `deliverShadowOutbound` ~598) | IA compõe normalmente; envio suprimido; `messages.simulated=true`. Resposta da IA e do humano coexistem na mesma conversa |
| Análise LLM batch por clínica | `src/app/api/cron/conversation-insights/route.ts` | Padrão `callLLM` (Claude/OpenAI via `ADVISOR_MODEL`), parse defensivo (`normalizeInsights`), tabela `clinic_operational_insights` |
| Alvos de config | `treatments` (preço, `priceQuotableInChat`, `aliases`, `durationMinutes`), `playbook_versions` (`toneOfVoice`, `objections[]`, `commercialPolicy`, `notes`, `receptionistName`), `organizations` (políticas) | O diff da Fase 3 escreve nesses campos |
| Rota owner por clínica | `src/app/api/owner/clinics/[clinicId]/channel-pairing/route.ts` | Padrão de auth (`requireOwner`) e tenant pelo `clinicId` da rota |

### O que NÃO existe

- Página pública tokenizada (nenhum `publicToken`/`shareToken` no código) — a
  página de validação introduz esse padrão.
- Qualquer fluxo de validação externa ou aplicação de diff de config.

---

## Decisão

Três fases, três PRs independentes e sequenciais. Nada é aplicado à
configuração sem aprovação humana em dois níveis: o responsável da clínica
valida o conteúdo; o owner aplica o diff.

### Fase 1 — Motor de estudo (`setup-study`)

Novo módulo `src/application/setup-study/` seguindo o padrão builders puros +
job.

**Tabela nova `setup_studies`** (migração em commit próprio):

```
id uuid PK
organization_id uuid FK → organizations (cascade)
status text: draft | sent | answered | applied | expired
findings jsonb  — SetupFinding[]
access_token_hash text        — sha256 do token da página pública
sent_at / answered_at / expires_at / created_at timestamptz
```

**`SetupFinding`** (tipo em `src/domain/`):

```ts
{
  id: string;
  category: "faq" | "price" | "tone" | "policy" | "schedule" | "escalation";
  claim: string;            // frase leiga: "Vocês respondem que a avaliação custa R$150 e abate"
  evidence: string[];       // trechos ANONIMIZADOS (sem nome/telefone de paciente)
  proposedChange: {
    target: string;         // ex.: "treatment:<id>.priceCents", "playbook.objections[]", "org.commercialPolicy"
    value: unknown;
  } | null;                 // null = achado informativo sem campo mapeado
  answer?: {
    status: "confirmed" | "corrected";
    correction?: string;    // texto livre do responsável
    answeredAt: string;
  };
}
```

**Geração sob demanda** (não cron): botão "Gerar estudo do shadow" na página
da clínica no owner → server action que:

1. Seleciona conversas do período de shadow com participação humana
   (`clinic_user`), limitadas (ex.: 50 conversas × 20 mensagens).
2. **Anonimiza antes do LLM**: substitui nomes de lead/telefones por
   placeholders no transcript.
3. Chama o LLM (padrão `callLLM`; usar modelo forte — o estudo é raro e
   valioso, não usar o mini do cron) pedindo achados por categoria com
   evidência citada.
4. Valida o shape em código (padrão `normalizeInsights`): claim não-vazio,
   category no enum, `proposedChange.target` num allowlist de alvos
   conhecidos. Achado fora do shape é descartado, nunca corrigido à mão.
5. Persiste `setup_studies` como `draft` para o owner revisar **antes** de
   enviar ao cliente (owner pode excluir achados constrangedores/errados).

**Regra "o sistema decide, a LLM verbaliza"**: a LLM só produz candidatos;
o mapeamento achado→campo é validado contra allowlist em código; a aplicação
(Fase 3) é determinística.

### Fase 2 — Página pública de validação

Novo padrão de rota pública tokenizada:

- Owner clica "Enviar para validação" → gera token aleatório (32 bytes,
  base64url), grava **só o hash** em `access_token_hash`, status → `sent`,
  `expires_at` = +7 dias. O link `https://app.systemops.com.br/validacao/<token>`
  é enviado pelo owner ao responsável (WhatsApp).
- Rota `src/app/(public)/validacao/[token]/` resolve o estudo **apenas pelo
  hash do token** — `clinicId` nunca aparece em URL ou payload. Token expirado
  ou estudo já `answered` → página de estado, não erro.
- UI mobile-first, linguagem leiga: um card por finding com
  **[✓ Está certo] [✏️ Corrigir]** (textarea). Salva progresso por item
  (POST parcial); botão final "Concluir" → status `answered`.
- Segurança: rate limit simples na rota, sem dados de paciente na página
  (garantido pela anonimização da Fase 1), sem session/cookie.

### Fase 3 — Diff e aplicação (owner)

- Bloco "Estudo de setup" na página da clínica
  (`src/app/(owner)/owner/clinics/[clinicId]/`): lista findings respondidos
  com antes → depois (valor atual do campo × valor proposto/corrigido).
- Aplicação **seletiva, item a item**, via server action que resolve o alvo
  pelo allowlist e escreve em `treatments`/`playbook_versions`/`organizations`.
  Correção em texto livre que não mapeia num campo → aplicada em
  `playbook_versions.notes` (orientação livre), nunca inventar parse.
- Ao aplicar: `status=applied`, cada finding marca o que foi feito. Trilha de
  auditoria fica no próprio `findings` jsonb.

---

## Regras do repo que se aplicam

- PRs baseados na `main`; `npm run verify` verde; **`revisor-multitenant`
  obrigatório** — a Fase 2 cria superfície pública nova.
- Tenant: rotas owner pelo `clinicId` da rota; rota pública **somente** pelo
  token hasheado.
- Migração drizzle em commit próprio (`npm run db:generate`;
  `npx tsx scripts/check-drizzle-meta.ts --fix` se `db:check` reclamar).
- Testes: builders puros da Fase 1 (extração de transcript, anonimização,
  validação de shape com LLM mockado); Fase 2 (token inválido/expirado,
  respostas parciais); Fase 3 (aplicação por categoria, allowlist rejeita
  target desconhecido).

## Consequências

- Nasce o padrão de página pública tokenizada — reutilizável (proposta
  comercial, relatório para cliente).
- Custo LLM baixo: ~1 chamada grande por estudo, evento raro por clínica.
- A ficha manual (`ficha-setup-clinica.md` Parte 1) vira fallback para o que
  conversa não revela (duração na cadeira, bloqueios, chave Pix).
- Subproduto futuro (fora deste ADR): comparar resposta da IA `simulated` vs.
  resposta do `clinic_user` na mesma conversa — gabarito para o plano de
  excelência conversacional.

## Fora de escopo

- Comparação IA×humano automatizada (excelência conversacional).
- Estudo contínuo/incremental pós-go-live (v2; este ADR cobre o evento de
  setup).
- Providers de canal não-Z-API.

## Piloto

Clínica Vitalli — estudo ao fim das ~2 semanas de shadow (≈20/07/2026).
Sequência real: gerar estudo → owner cura → link para o Dr. Victor → diff →
aplicar → go-live com preset conservador do channel safety.

## Esforço estimado

| Fase | Esforço |
|---|---|
| 1 — Motor + tabela | 2–3 dias |
| 2 — Página pública | 2 dias |
| 3 — Diff/aplicação | 1–2 dias |

---

## Apêndice de execução — decisões fechadas (não reabrir)

Ambiguidades que um executor teria que decidir sozinho, já decididas aqui.

### A. Allowlist de targets (v1 — exatamente estes)

```
treatment:<uuid>.priceCents          (+ priceKind, priceUnit juntos no mesmo finding)
treatment:<uuid>.priceQuotableInChat
treatment:<uuid>.aliases             (append, nunca substituir)
treatment:<uuid>.requiresEvaluationFirst
playbook.objections[]                (append { objection, response })
playbook.toneOfVoice
playbook.commercialPolicy            (substituição com antes/depois visível)
playbook.notes                       (append — destino de toda correção livre não mapeável)
```

Categoria `schedule` e `escalation` na v1 geram finding **informativo**
(`proposedChange: null`) — aparecem no doc de validação, mas a aplicação é
manual pelo owner. Não tentar escrever em disponibilidade/regras de escalada
na v1.

### B. Query do corpus (Fase 1, builder testável)

- Conversas da clínica com `>= 1` mensagem `author='clinic_user'` no período
  `organizations.channelPairedAt → now()` (fallback: últimos 21 dias se
  `channelPairedAt` null).
- Ordenar por `lastMessageAt` desc; máx. **50 conversas × 30 mensagens**
  (mais antigas truncadas). Incluir `author`, `body`, `sentAt`, `simulated`.
- Excluir conversas de grupo não existe (webhook já filtra); excluir mensagens
  `author='system'`.

### C. Anonimização (builder puro, com teste)

Antes de montar o transcript para o LLM:

- Nome do lead (`leads.name`) → `[PACIENTE]` (match case-insensitive no body).
- Qualquer sequência de 8+ dígitos (com ou sem máscara) → `[TELEFONE]`.
- `senderName`/apelidos não são enviados; identificar falantes só como
  `PACIENTE:` / `CLINICA:` / `IA(shadow):`.
- Os `evidence[]` persistidos em `findings` já saem anonimizados (a página
  pública nunca vê dado bruto).

### D. Contrato do prompt (Fase 1)

Saída exigida do LLM — JSON único:

```json
{ "findings": [ {
    "category": "faq|price|tone|policy|schedule|escalation",
    "claim": "frase leiga em pt-BR, máx 200 chars",
    "evidence": ["trecho curto do transcript"],
    "target": "um da allowlist OU null",
    "value": "valor proposto (número em centavos p/ preço; string caso contrário)"
} ] }
```

Parse defensivo (padrão `normalizeInsights`): item sem `claim`/`category`
válidos é descartado; `target` fora da allowlist vira `proposedChange: null`
(rebaixa para informativo, não descarta). Máx. 15 findings persistidos.

### E. LLM client

Extrair o `callLLM` de `conversation-insights/route.ts` para helper
compartilhado `src/infrastructure/llm/advisor-llm.ts` (mesma assinatura,
usado pelos dois). Env nova `SETUP_STUDY_MODEL` (default
`claude-sonnet-5`) — estudo é raro e valioso; não usar o mini do cron.
`max_tokens` 4000.

### F. Curadoria do draft (escopo da Fase 1, UI mínima)

Na página da clínica do owner: lista dos findings do estudo `draft` com
botão **excluir** por item e edição inline do `claim`. Sem drag/reorder, sem
preview da página pública. "Enviar para validação" só entra na Fase 2.

### G. Rota pública (Fase 2)

- Criar grupo novo `src/app/(public)/validacao/[token]/` — **não existe grupo
  público hoje**; layout próprio sem sidebar/sessão.
- Token: 32 bytes `crypto.randomBytes` em base64url; banco guarda só
  `sha256(token)`; lookup por hash com comparação direta (índice único).
  Brute force é inviável no espaço de 256 bits → **rate limit dispensado na
  v1** (registrar essa decisão em comentário na rota).
- Token exibido ao owner **uma única vez** na geração (padrão de API key).
- Estados da página: válido (form), expirado, já respondido, concluído.
  Respostas parciais: POST por finding (`answer` no jsonb), idempotente.

### H. Localização dos arquivos

```
src/domain/entities/setup-study.ts              — tipos SetupStudy/SetupFinding
src/application/setup-study/build-corpus.ts     — query+anonimização (B, C)
src/application/setup-study/extract-findings.ts — prompt+parse (D)
src/application/setup-study/apply-finding.ts    — aplicação por allowlist (Fase 3)
src/infrastructure/llm/advisor-llm.ts           — callLLM compartilhado (E)
src/app/(owner)/owner/clinics/[clinicId]/setup-study/ — UI owner + actions (F, Fase 3)
src/app/(public)/validacao/[token]/             — página pública (G)
```

Server actions owner seguem o padrão `assertOwnerSession()` de
`src/app/(owner)/owner/clinics/[clinicId]/modules/actions.ts`.
