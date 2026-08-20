# SystemOps Harness — Design Input

**Isto não é o design do Harness. É a especificação do problema.**

Escrito em 2026-08-20 para a sessão seguinte, que fará pesquisa de estado da arte
e arquitetura. Nenhuma tecnologia foi escolhida aqui, de propósito — ver
*Decisions intentionally left open*.

Tudo abaixo é evidência colhida do repositório real. Onde não houve prova, está
escrito que não houve.

---

## Business / engineering objective

O SystemOps é operado por **uma pessoa** com agentes de IA como capacidade de
engenharia principal. O produto já está em produção, atendendo clínicas reais
pelo WhatsApp, com dinheiro e reputação de clientes em jogo.

O trabalho de engenharia acontece hoje em sessões de agente. Cada sessão começa
fria, reconstrói contexto lendo documentação e git, executa, e termina —
frequentemente com estado importante vivendo só na cabeça daquela sessão ou no
disco local.

O objetivo do Harness é tornar esse modo de trabalho **confiável e contínuo**:
que trabalho não se perca entre sessões, que contexto não precise ser
reconstruído do zero, e que as invariantes de segurança do produto sejam
respeitadas por construção e não por lembrança.

Não é sobre escrever código mais rápido. É sobre **não perder trabalho e não
quebrar produção**.

---

## Current engineering workflow

Como o trabalho acontece hoje, observado:

1. Humano abre uma sessão de agente com um objetivo em prosa, às vezes longo.
2. O agente lê `AGENTS.md`, docs de arquitetura, e inspeciona o git.
3. Para iniciativa grande: escreve um **spec** (`## 1. Decisão`, `## 2. O
   problema, com evidência`) e depois um **plan** executável, ambos em
   `docs/superpowers/`, nomeados por data.
4. Trabalho isolado em **git worktree** — o padrão da casa (havia 14 worktrees
   antes da limpeza de 20/08).
5. Implementação com testes; `AGENTS.md` lista os tipos de mudança que
   **obrigam** teste.
6. `npm run verify` local. CI só roda em `pull_request`.
7. PR para `develop`, merge commit (30 dos últimos 30 merges).
8. Promoção `develop` → `main` é evento separado, manual, com runbook aberto.
9. Fechamento de ciclo escrito em `docs/ai-system/`.
10. Handoff para a próxima sessão em prosa, às vezes um doc `-handoff.md`.

Provedores: hoje predominantemente Claude (Claude Code). Há sinal de outros
modelos em commits (`Co-Authored-By: Claude Opus 4.8`), mas **nenhuma
infraestrutura de agente é versionada** — `.claude/` está no `.gitignore`, e não
há MCP, hooks ou skills no repositório.

---

## Existing strengths

Somente o que é verificável:

- **Gate único e rápido.** `npm run verify` = `db:check && lint && typecheck &&
  test`, ~40s, **399 arquivos / 3589 testes / 0 falhas**.
- **12 guardas arquiteturais executáveis** em `src/__tests__/arch/` — fronteiras
  são teste, não convenção: `CoreImportBoundary`, `DentalPackBoundary`,
  `TenantEngineRouterBoundary`, `ConversationV2NoLiveExecution`,
  `V2ShadowWriteBoundary`, `SystemOpsLabScope`, `CapabilityContract`,
  `CoordinatorBudget`, `CoreDomainLexicon`, `V1ObservationSeamBoundary`,
  `ConversationV2RuntimeBoundary`, mais `domain-lexicon.json`.
- **Attestation por commit já implementada.** A approval do Internal Lab é
  assinada contra o `commitSha` implantado, com digests de tenant, canal e
  config. Existe signer, verificador e prova de rollback.
- **Corpus rotulado** — 66 casos em 19 categorias, com baseline e medida de
  concordância entre revisores.
- **Runbook com formato de passo executável**: cada seção tem
  *precondition / expected / "retorna a V1 se"*.
- **Fail-closed é o default.** Divergência mantém o tenant na V1.
- **Decisão registrada junto do código, com medição.** `ci.yml` explica em 14
  linhas por que roda só em `pull_request`, citando "17 dos últimos 40 PRs
  mergeados tocavam apenas `docs/`". 43 arquivos sob `src/` citam `docs/`.
- **Corpo de commit é registro, não rótulo** — média de 11 linhas nos últimos 50.

---

## Existing pain points

Observados, com evidência:

1. **Trabalho existindo só no disco local.** Em 20/08 havia 15 commits sem
   remoto e um script de 332 linhas **nunca commitado em lugar nenhum**, dentro
   de um worktree em detached HEAD. O repositório não tinha como detectar isso.
2. **Estado local invisível e acumulado.** Hoje, fora do versionamento:
   `scripts/scratch/` com **44 scripts `.ts` de uso único** escritos em
   investigações passadas (vários com prefixo `claude-`), 9.2 MB; ~840 KB de
   exports de conversa real; `.claude/` e `.superpowers/brainstorm/` com estado
   de ferramenta; três arquivos `.env*` com credenciais.
3. **Contexto reconstruído do zero a cada sessão.** Não há formato de handoff
   estruturado — o estado passa em prosa e desatualiza calado.
4. **Documento envelhece sem aviso.** Foi preciso criar
   `document-status-index.md` em 20/08 porque nada distinguia plano de
   inventário. 8 planos citam caminhos inexistentes.
5. **Formato de decisão morreu sem substituto.** Todos os ADRs foram apagados em
   `3115cefd`. Decisões reais vivem em corpo de commit de branch não mergeada —
   ver `decision-recording-today.md`.
6. **Árvore suja causa falha de teste enganosa.** `npm test` com arquivos staged
   e não commitados produz 32 falhas com
   `Cycle I productive measurement requires a clean repository tree`, sem
   relação com a mudança. Só foi documentado no `AGENTS.md` em 20/08.
7. **Deriva de branch/worktree.** 14 worktrees, uma delas segurando `develop`
   368 commits atrás. Branch cujo tip é snapshot morto enquanto o conteúdo
   entrou por outro SHA — ancestralidade engana; só `git cherry` responde.
8. **Acoplamento approval/deploy com falha silenciosa.** Deploy invalida a
   approval; o Lab para de responder e **nenhum erro aparece**.
9. **Avaliação sem revisores humanos.** O gate do Cycle I termina em `NO_GO` com
   `pending_human_review` porque os dois revisores calibrados não existem. É o
   resultado correto, e bloqueia qualquer automação que dependa de `PASS`.
10. **Trabalho bom morrendo em PR fechada.** Duas PRs foram fechadas no mesmo
    instante (`2026-08-13T14:07:45Z`) carregando trabalho real; uma delas contém
    a correção de um hardcode de cliente em código multi-tenant.
11. **Identificadores de cliente espalhados pelo código.** Nomes de clínicas
    reais aparecem em 56 e 68 arquivos sob `src/`; nomes pessoais de leads reais
    em 5 arquivos versionados. Qualquer harness que envie contexto do repositório
    a um provedor externo envia isso junto.

---

## Non-negotiable invariants

Extraídos do sistema real. Um Harness que viole qualquer um destes é inaceitável.

1. **O sistema decide, o LLM verbaliza.** Regra de negócio vive em código
   determinístico e testado, nunca em texto de playbook ou instrução de modelo.
2. **`main` é produção.** Nunca push direto, exceto hotfix aprovado
   explicitamente. `develop` é integração.
3. **Fail-closed para V1.** Qualquer divergência mantém o tenant na V1.
   *(Esta invariante tem prazo de validade — ver "Perguntas em aberto herdadas do
   produto" abaixo.)*
4. **A approval é vinculada ao commit implantado.** Deploy novo exige reassinar
   (runbook §18, §20, §21; §19 quando o commit é novo).
5. **Isolamento por tenant**, garantido por guarda executável.
6. **`npm run verify` nunca envolvido em `dotenv -e .env.local`** — foi assim que
   teste de integração escreveu no banco compartilhado.
7. **Segredo nunca no repositório.** Private key da authority só por
   `--private-key-file`.
8. **`NO_GO` não é reinterpretável.** O runbook manda voltar à V1 se alguém
   tentar promover esse estado.

---

## Existing reusable assets

| Ativo | Caminho | Por que serve |
|---|---|---|
| Gate de verificação | `package.json` → `verify` | único, rápido, já respeitado |
| Guardas arquiteturais | `src/__tests__/arch/` | fronteiras já executáveis |
| Corpus + eval | `evals/corpus/`, `scripts/eval-corpus.ts`, `scripts/eval-intent.ts` | avaliação com baseline e concordância |
| Replay sanitizado | `scripts/*-replay-*.ts` (7 comandos `replay:*`) | pipeline de replay aprovado |
| Observabilidade de decisão | `src/core/observability/DecisionTrace.ts`, `V1TurnObservation.ts` | instrumentação já no lugar |
| Attestation por commit | `scripts/sign-internal-lab-approval.ts`, `src/application/conversation-v2/` | modelo de aprovação assinada implementado e testado |
| Formato de passo executável | `docs/operations/systemops-lab-runbook.md` | precondition / expected / rollback |
| Contrato de agente | `AGENTS.md` | já escrito e respeitado |
| Formato spec+plan | `docs/superpowers/` | planejamento em uso |
| Índice de status | `docs/engineering/document-status-index.md` | distingue ativo de histórico |
| Contratos de replay/trace | `docs/architecture/replay-fidelity-contract.md`, `replay-and-decision-trace.md` | |

---

## Failure modes already experienced

Cada um aconteceu neste repositório.

| Modo de falha | Evidência |
|---|---|
| Trabalho só local | 15 commits sem remoto; script de 332 linhas nunca commitado, em detached HEAD (20/08) |
| Contexto perdido entre sessões | handoffs em prosa; `document-status-index.md` precisou ser criado para distinguir plano de estado |
| Árvore suja = falha falsa | 32 testes falhando por `Cycle I productive measurement requires a clean repository tree` |
| Deriva de branch/worktree | worktree segurando `develop` 368 commits atrás; tips que são snapshot morto |
| Documentação obsoleta | 8 planos citando caminhos inexistentes; ADR-009 citado por doc escrito **depois** de o ADR ser apagado |
| Acoplamento approval/deploy | runbook §21-A: "É silencioso: nenhum erro aparece, apenas o Lab para de responder" |
| Avaliação sem revisor humano | gate do Cycle I em `NO_GO` / `pending_human_review` |
| Plano confundido com estado real | plano do Cycle I cita `human-review-r1.json`, que nunca existiu |
| Decisão perdida em PR fechada | PR #232 — medição (871 registros, US$ 2,45) e gotcha de migração de enum só no corpo do commit |
| Correção boa nunca aplicada | PR #257 — remove hardcode `"victor"` de código multi-tenant; nunca mergeada |
| Migração com número colidido | duas branches trazem `0083` e `0095` que já existem na `develop` |

---

## Required capabilities of a future Harness

Formuladas como **necessidade**, não solução.

1. O sistema **deve** detectar trabalho que existe apenas em disco local, antes
   que a sessão termine.
2. O sistema **deve** preservar estado de tarefa através de troca de sessão,
   agente ou provedor.
3. O sistema **deve** distinguir, de forma verificável, documento que descreve
   estado atual de documento que descreve intenção ou história.
4. O sistema **deve** tornar a decisão de arquitetura recuperável por busca,
   incluindo alternativas descartadas — hoje isso vive em corpo de commit.
5. O sistema **deve** impedir que uma invariante de segurança seja violada por
   esquecimento, e não apenas documentá-la.
6. O sistema **deve** reconhecer o estado do repositório antes de executar
   verificação, para não reportar falha causada por árvore suja.
7. O sistema **deve** deixar claro quando um resultado de avaliação depende de
   revisão humana ausente, sem permitir que seja lido como aprovação.
8. O sistema **deve** dar a uma sessão nova o contexto suficiente sem exigir
   releitura de meses de histórico.
9. O sistema **deve** rastrear trabalho em voo entre worktrees e branches, e
   sinalizar deriva.
10. O sistema **deve** permitir que trabalho não mergeado seja avaliado por
    valor, não descartado por idade.
11. O sistema **deve** tratar identificador de cliente como dado sensível ao
    montar contexto para um provedor externo.
12. O sistema **deve** permitir que o humano seja o portão em decisões
    irreversíveis — deploy, promoção, approval — sem virar gargalo no resto.

---

## Perguntas em aberto herdadas do produto

Não são decisões do Harness, mas o design precisa saber que existem, porque a
resposta muda o que o Harness pode assumir sobre segurança.

### A rede de proteção da V2 depois que a V1 sair

Hoje a resposta para *"e se a V2 errar?"* é uma só: **cai para a V1**. É o
colchão inteiro. O router é fail-closed, e a V1 está congelada com a tag
`v1-frozen` exatamente para ser o ponto de retorno.

O `target-architecture.md` descreve a saída pela **Estratégia Strangler**, em 7
passos. O passo 4 é "rotear um tenant de teste para o novo worker" — é onde o
projeto está hoje. O passo 6 é "ampliar por tenant". O passo 7 é **"remover o
caminho antigo somente depois do rollback window"**.

No passo 7, "cair para a V1" deixa de significar alguma coisa.

**Nenhum documento diz o que entra no lugar.** Verificado em 2026-08-20: o
desenho mestre de 09/08 tem 20 seções e nenhuma trata de aposentar a V1; o
`target-architecture.md` diz "remover o caminho antigo" sem nomear a rede de
proteção sucessora.

Duas consequências para o design do Harness:

1. A approval do Internal Lab **morre sozinha** e não precisa ser removida. Ela
   só existe porque o Lab é `operationalStatus=test`, o que desliga a automação
   por padrão — a approval é a exceção que religa. O reader curto-circuita na
   primeira linha (`if (baseMode !== "disabled") return baseMode;`), então para
   tenant com status normal ela nunca é consultada. Não desenhe nada em cima
   dela como se fosse permanente.
2. A coluna `conversation_engine` por tenant é o eixo do passo 6 e vive mais
   tempo, mas também termina no passo 7.

O que **não** tem sucessor definido é a garantia de rollback. Se o Harness for
apoiar verificação e segurança de mudança conversacional, essa é a lacuna que
ele encontra pela frente — e provavelmente a resposta se monta com o que já
existe em replay, `DecisionTrace` e evals, não com um mecanismo novo.

**Esta seção registra a pergunta. Não a responde.**

## Decisions intentionally left open

Nada disto foi escolhido, e não deve ser inferido de nada acima:

- grafo ou não-grafo; LangGraph, Temporal, custom, ou nenhum framework;
- modelo de orquestração — sequencial, multi-agente, hierárquico;
- abstração de provedor, e se deve haver adapters por provedor
  (`CLAUDE.md`/`CODEX.md`/etc.) ou um formato único;
- onde vive o estado — arquivo no repo, banco, event store, serviço;
- formato de skill, e se skills devem ser versionadas;
- hooks: quais, onde, e se o harness os possui;
- topologia de MCP, se houver MCP;
- formato de registro de decisão — ADR, decision-log, grafo, extração de commit;
- quantos agentes, e com que papéis;
- portões humanos: quais passos exigem aprovação e como ela é registrada;
- se o Harness vive neste repositório ou fora dele.

---

## Canonical reading list

Curta e ordenada. Os cinco primeiros bastam para entender as restrições.

1. `AGENTS.md` — contrato de agente
2. `docs/engineering/HARNESS-HANDOFF.md` — mapa de entrada
3. `docs/engineering/harness-readiness-2026-08-20.md` — inventário
4. `docs/operations/systemops-lab-runbook.md` — §13, 16, 18–21, **21-A**, 23
5. `docs/architecture/current.md` e `sources-of-truth.md`
6. `docs/engineering/document-status-index.md` — o que é ativo vs histórico
7. `docs/engineering/decision-recording-today.md` — onde decisão vive hoje
8. `src/__tests__/arch/` — as fronteiras executáveis
9. `package.json` → `scripts` — o vocabulário de execução
10. `.github/workflows/ci.yml` — o gate, e as decisões por trás dele

---

## Definition of success for Harness design

O design está pronto quando responde, de forma verificável:

1. **Perda de trabalho:** como o sistema detecta e impede que trabalho exista só
   em disco local? Testável contra o cenário real de 20/08.
2. **Continuidade:** um agente novo, sem histórico, consegue retomar uma tarefa
   em andamento a partir de artefatos versionados?
3. **Verdade documental:** como se distingue estado de intenção sem depender de
   um índice mantido à mão?
4. **Invariantes:** cada uma das 8 invariantes acima está protegida por
   mecanismo, não por instrução?
5. **Portões humanos:** deploy, promoção e approval continuam humanos, e o
   resto flui sem gargalo?
6. **Custo:** o design é operável por **uma pessoa**, e não exige um time para
   manter o próprio harness?
7. **Reuso:** aproveita os ativos existentes em vez de recriá-los?
8. **Reversibilidade:** é possível desligar o Harness e continuar trabalhando do
   jeito atual?

Um design que não responda 1, 2 e 4 não resolve o problema que motivou esta
sessão.
