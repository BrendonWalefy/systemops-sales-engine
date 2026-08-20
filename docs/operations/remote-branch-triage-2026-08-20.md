# Triagem das branches remotas não mergeadas — 2026-08-20

**Nenhuma branch remota foi apagada.** Este documento existe para que a limpeza
futura seja uma decisão informada, não uma contagem.

## Método

Uma branch não ser ancestral de `origin/main` **não** significa que o trabalho
dela está fora de produção. A maioria destas branches teve a PR mergeada e
recebeu um commit depois, ou foi rebaseada/esmagada no merge — o tip virou um
snapshot morto enquanto o conteúdo entrou por outro SHA.

Por isso a triagem não usou ancestralidade. Usou três sinais:

1. `git cherry origin/develop origin/<branch>` — detecta **patch equivalente**,
   independente de SHA;
2. estado da PR pela API do GitHub (295 PRs consultadas);
3. presença dos arquivos da branch em `origin/develop`.

Contagem: **35 branches remotas** não são ancestrais de `origin/main`, de um
total de 125.

---

## A. Trabalho ativo/relevante — NÃO APAGAR

| Branch | Tip | Data | Commits fora da develop | Situação |
|---|---|---|---|---|
| `feat/dental-resin-template` | `ac57da7c` | 2026-08-11 | 15 | Sem PR. Publicada no housekeeping de 20/08. Contrato de template + manifesto odontológico, puramente aditivo. **É trabalho vivo esperando decisão.** |
| `feat/v2-llm-verbalization` | `9678466e` | 2026-08-19 | 1 | PRs #290–#293 mergeadas. O commit restante é um doc de briefing da V2. Branch do programa V2, tem worktree dedicada. |

## B. Preservação / WIP — NÃO APAGAR

Criadas na sessão de housekeeping de 2026-08-20. Existem para que nada dependa
só do disco local. Detalhes em `repository-housekeeping-2026-08-20.md`.

| Branch | Tip | Conteúdo |
|---|---|---|
| `chore/preserve-replay-last-leads-shadow` | `0140dc66` | script de replay shadow que nunca tinha sido commitado em lugar nenhum |
| `wip/conversation-objectivity-checkpoint` | `0085c431` | WIP de objetividade de 18/07; `slotsWillFollow` e `deliverOnFirstContact` não existem na develop |
| `wip/internal-lab-tests-draft-checkpoint` | `0ed6f486` | rascunho superado de testes do Lab, preservado com a prova |
| `docs/repository-housekeeping-2026-08-20` | `b53b6d35` | esta documentação (PR #295) |

## D/F. Não mergeadas, PR fechada sem merge — DECISÃO HUMANA

As duas foram fechadas **no mesmo instante**, `2026-08-13T14:07:45Z`, o que
parece limpeza em lote e não rejeição individual. Ambas contêm trabalho real que
nunca entrou, e ambas têm **colisão de número de migration** com a `develop` —
não dá para mergear como estão.

### `chore/renomeia-operacao-custo` — `bb8d0b63`, 2026-07-22, PR #232 CLOSED

Renomeia `sales_conversation_analysis` para `conversation_reply`. Toca
`ConversationOrchestrator`, `usage-cost-tracker`, `zapi-channel-adapter`,
`actions.ts` e traz `drizzle/0083_soft_silver_surfer.sql`.

**Bloqueio:** a `develop` já tem um `0083` diferente
(`0083_magenta_red_shift.sql`). Retomar exige renumerar a migration.
Único arquivo ausente da develop além da migration:
`docs/product/auditoria-envios-automaticos.md`.

**Recomendação:** decidir se a renomeação ainda é desejada. Se sim, refazer sobre
a `develop` atual em vez de ressuscitar a branch. **F — incerta.**

### `chore/investor-readiness` — `5af9c058`, 2026-08-06, PR #257 CLOSED

Sanitização do repositório para revisão de investidor + posicionamento do agente
de IA. Toca `.env.example`, `prompts/sales-agent/system.md`, workflow de E2E,
`docs/compliance/lgpd-healthcare.md` e traz
`drizzle/0095_agent-role-positioning.sql`.

**Bloqueio:** a `develop` já tem um `0095` diferente
(`0095_luxuriant_shocker.sql`), e já tem `prompts/sales-agent/`.

Arquivos ausentes da develop: a migration, mais
`src/__tests__/ConversationPatternsRegression.test.ts`,
`src/__tests__/ResolveDefaultProfessional.test.ts` e
`src/__tests__/fixtures/calendar-demo.ics`. **Os dois testes ausentes são o
ponto que merece um olhar** — podem ser cobertura que nunca entrou.

**Recomendação:** revisar os dois testes especificamente. **F — incerta.**

## C. Superseded — conteúdo entrou por outro caminho

Todas com PR mergeada. O tip é um snapshot morto; a `develop` tem o conteúdo, e
em vários casos já evoluiu além dele.

| Branch | PR | Nota |
|---|---|---|
| `feat/endereco-completo` | #229 MERGED | migration `0082` e `AddressAndConfirmation.test.ts` presentes na develop |
| `feat/inbox-fiel-whatsapp` | #233 MERGED | **todos** os arquivos presentes na develop (link-preview, cache, migration `0083`, teste) |
| `feat/conversation-modes` | #241 MERGED | verbosity/drive em produção desde 23/07 |
| `feat/reativacao-campanhas` | #227 MERGED | suíte de reativação presente na develop |
| `feat/reativacao-motor` | #226 MERGED | idem |
| `docs/item10-reauditado` | #219 MERGED | o teste entrou; o doc foi consolidado (ver abaixo) |

### Conhecimento que saiu da develop de propósito

Três arquivos aparecem como "ausentes da develop" nessas branches, e a ausência é
**deliberada**, não perda:

- `docs/product/plano-correcao-conversacional.md` e
  `docs/product/auditoria-envios-automaticos.md` — apagados em `3115cefd`
  *"docs: consolidate current architecture"* (06/08). Hoje `docs/product/` tem um
  único arquivo.
- **Todos os ADRs** (`docs/architecture/adr/`, incluindo o ADR-009 do Motor de
  Reativação) foram apagados no mesmo commit `3115cefd`. Não existe nenhum ADR
  na `develop` hoje; a arquitetura vive em `docs/architecture/current.md` e
  `target-architecture.md`.

Isso é relevante para quem for desenhar o Harness: **o repositório abandonou ADRs
como formato.** O histórico continua no git e nessas branches.

## E. Candidatas seguras para remoção futura

Para todas: PR mergeada **e** `git cherry` diz que cada commit já tem patch
equivalente na `develop`. Apagar o ref remoto não remove nenhuma linha de código
que exista hoje.

`feat/media-library-foundation` · `fix/pipeline-media-resolution-prod` ·
`fix/qa-photo-append-readiness` · `hotfix/lineeh-photo-evaluation` ·
`fix/inbox-ia-status-reflete-pausa-clinica` · `chore/ci-so-em-pr` ·
`docs/casos-victor-21-07` · `fix/abertura-indevida-lead-sem-resposta` ·
`fix/confirmacao-direta-slot-unico` · `fix/continuacao-curta-contexto` ·
`fix/sabado-agenda-real` · `chore/ci-ignora-docs` · `feat/link-curto` ·
`feat/mensagem-localizacao` · `fix/campanha-prazo-oferta` ·
`fix/preco-por-imagem` · `fix/preview-image-longa` · `feat/inbox-card-preview` ·
`fix/lead-upsert-lid-phone` · `perf/trigger-sender-imediato`

**20 branches.** Mais as **90** que já são ancestrais de `origin/main` e nem
entraram nesta lista.

Antes de apagar qualquer uma, revalide — este documento envelhece:

```bash
git fetch origin --prune
git cherry origin/develop origin/<branch>   # nenhuma linha começando com '+'
```

## Resumo

| Categoria | Quantas | Ação |
|---|---|---|
| A — ativo | 2 | manter |
| B — preservação | 4 | manter |
| C — superseded | 6 | manter por ora; remoção segura, valor baixo |
| E — candidatas seguras | 20 | remoção futura, com revalidação |
| F — incerta | 2 | **decisão humana** |
| **Total não-ancestral de `main`** | **34** + 1 (`chore/developer-onboarding`, mergeada durante a sessão) | |
