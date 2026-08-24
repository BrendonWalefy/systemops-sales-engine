# Triagem das branches remotas não mergeadas — 2026-08-20

> **Documento histórico.** Triagem feita em 2026-08-20. Branches mudam:
> revalide com `git fetch origin --prune` e
> `git cherry origin/develop origin/<branch>` antes de agir sobre qualquer uma.


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

---

## Resolução das duas categoria F — análise de 2026-08-20

Feita depois da triagem inicial. **Nenhuma das duas foi mergeada, e nenhuma
migration antiga foi ressuscitada.** A análise foi de requisito, não de rebase.

### `chore/investor-readiness` — resolvido

Os três arquivos "ausentes da develop" foram examinados um a um.

**`ConversationPatternsRegression.test.ts` — `SUPERSEDED`, zero cobertura nova.**
É `src/__tests__/XimendesConversationPatterns.test.ts` renomeado. Prova: 381
linhas em ambos, 34 `it(...)` em ambos, e depois de normalizar o nome da clínica
os arquivos diferem **apenas** em comentários de cabeçalho e em nomes próprios
(`Gregorie` → `Silva`). Não há um único caso de teste novo. Não portar.

**`fixtures/calendar-demo.ics` — `SUPERSEDED`.** É a versão anonimizada do
`vitalli-agenda-exemplo.ics` que já está versionado na raiz — e o versionado já
usa nomes sintéticos (João Silva, Maria Santos). Não portar.

**`ResolveDefaultProfessional.test.ts` — `REQUISITO AINDA VÁLIDO`, e é o achado
que importa.**

O teste cobre `selectUnambiguousDefaultProfessionalId`, uma função que **não
existe na `develop`**. O que existe é
`src/application/calendar/resolve-default-professional.ts`, com isto:

```ts
const named = clinicProfessionals.find((p) => p.name.toLowerCase().includes("victor"));
if (named) return named.id;
```

Dois problemas, ambos em código multi-tenant:

1. **Nome de cliente hardcoded.** Qualquer clínica com um profissional cujo nome
   contenha "victor" recebe automaticamente os agendamentos importados, seja
   qual for a intenção daquele tenant. O comentário no arquivo assume a
   responsabilidade ("Regra pragmática para o caso real (Vitalli)").
2. **Não filtra `isActive`.** A consulta lê todos os profissionais. Um
   profissional inativo conta para a checagem de "só existe um" e pode ser
   devolvido como padrão. A coluna `professionals.is_active` existe no schema.

`resolveDefaultProfessionalId` é chamada de **quatro** lugares, todos
multi-tenant: o webhook do Google Calendar, o cron `calendar-watch-renew`, o
import de calendário da clínica e o import do setup.

A branch corrigia os dois: extraía uma função pura sem heurística de nome e
filtrava `isActive`.

**Não foi corrigido nesta sessão, por decisão.** A correção muda comportamento
funcional de um cliente ativo — hoje a Vitalli depende dessa atribuição
automática, e removê-la faria agendamentos importados passarem a ficar sem
profissional. Isso é mudança de produto, não bug de proteção trivial, e o
mandato desta sessão era explicitamente não alterar comportamento.

**Backlog, com o requisito já formulado:** a escolha do profissional padrão não
deve depender de nome de pessoa hardcoded, e deve ignorar profissional inativo.
A branch mostra uma implementação possível; a decisão de produto é o que falta.

### `chore/renomeia-operacao-custo` — resolvido

**A renomeação proposta ficou `SUPERSEDED`; o problema que ela apontava continua
`VÁLIDO`.**

A branch queria renomear o valor de enum `sales_conversation_analysis` para
`conversation_reply`, porque o nome sugere relatório em background quando na
verdade é o custo de **toda resposta que a IA dá** — a linha de frente do
produto.

O diagnóstico continua correto: o valor ainda existe na `develop`, usado em 6
arquivos de código (`usage-cost.ts`, `usage-cost-tracker.ts`, `schema.ts`,
`ConversationOrchestrator.ts`, `actions.ts`,
`analyze-sales-conversation.ts`), e o nome ainda engana.

**Mas o nome proposto agora está ocupado.** `conversation_reply` passou a
significar outra coisa na `develop`: é o `kind`/`category` de uma mensagem de
saída no caminho da V2, presente em 13 arquivos
(`SendMessageJob`, `ReplayOutboundCapture`, `InternalLabSyntheticDelivery`,
`ConversationResponsePlanner`, …). Reaproveitar o termo para um valor de enum de
custo criaria ambiguidade nova em vez de resolver a antiga.

**Conhecimento a preservar do corpo do commit**, que não existe em nenhum outro
lugar do repositório:

- a medição que motivou — 871 registros, US$ 2,45, "mais que a feature de
  reativação inteira";
- que `analyze-sales-conversation` **não tem nenhum chamador** e
  `agent_recommendations` está vazia;
- **o gotcha de migração**: o `drizzle-kit` gera `DROP TYPE + CREATE TYPE + cast`
  para renomear valor de enum, e isso falha, porque no momento do cast as linhas
  existentes ainda contêm o valor antigo, ausente do tipo recriado. A saída é
  `ALTER TYPE RENAME VALUE`, atômico e preservando a posição ordinal.

Esse último item é operacionalmente relevante para qualquer automação que gere
migrations. Está registrado em `../engineering/decision-recording-today.md` como
exemplo de decisão que só vive em corpo de commit.

**Recomendação:** manter a branch como referência; se a renomeação for retomada,
escolher um nome novo (o proposto colide) e refazer sobre a `develop` atual. A
migration `0083` da branch é `OBSOLETA` — colide com o `0083` já existente.

### Classificação final

| Artefato | Classe |
|---|---|
| `ConversationPatternsRegression.test.ts` | `SUPERSEDED` — rename puro |
| `fixtures/calendar-demo.ics` | `SUPERSEDED` |
| `ResolveDefaultProfessional.test.ts` | **requisito ainda válido** → backlog |
| hardcode `"victor"` + `isActive` ausente | **bug de isolamento multi-tenant** → backlog, exige decisão de produto |
| renomeação `sales_conversation_analysis` | problema válido, **nome proposto superseded** |
| gotcha `ALTER TYPE RENAME VALUE` | **documentação histórica a preservar** |
| migrations `0083` e `0095` das branches | `OBSOLETAS` — colidem |

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
