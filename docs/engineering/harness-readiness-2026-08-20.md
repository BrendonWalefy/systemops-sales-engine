# Harness Readiness

Fotografia factual do que **existe hoje** no repositório e que será relevante ao
desenhar um Harness de engenharia com agentes. Levantado em 2026-08-20.

Este documento não propõe arquitetura. Onde há opinião, ela está marcada como
recomendação. Tudo o mais é verificável com os comandos e caminhos citados.

---

## Repository state

> **Snapshot de 2026-08-20.** Os SHAs abaixo envelhecem a cada merge em
> `develop`. **Não os copie para lugar nenhum; resolva em runtime:**
>
> ```bash
> git fetch origin --prune
> git rev-parse origin/main origin/develop
> git rev-list --left-right --count origin/main...origin/develop
> gh api repos/BrendonWalefy/systemops-sales-engine/deployments \
>   -q '.[] | select(.environment=="Production") | "\(.sha[0:8])  \(.created_at)"' | head -1
> ```

| | Snapshot em 2026-08-20 |
|---|---|
| `main` (produção) | `0d0015cf` |
| **Produção implantada** | `0d0015cf`, deploy em 2026-08-19T03:52:05Z — **igual a `main`**, confirmado pela API de deployments |
| `develop` (integração) | `3833eab7` |
| Divergência `main...develop` | 0 / 26 — `main` não tem nada exclusivo |
| Worktrees | 3, todas limpas |
| PRs abertas | nenhuma |

Worktrees: a canônica; `systemops-sales-engine-template`
(`feat/dental-resin-template`); `systemops-sales-engine-v2`
(`feat/v2-llm-verbalization`).

`main` é produção e deploya via Vercel. `develop` é a branch de integração.
Promover `develop` → `main` **invalida a approval do Internal Lab** — ver
`../operations/develop-to-main-promotion-plan.md`.

---

## Existing agent infrastructure

O que já existe para agentes:

| Artefato | Estado |
|---|---|
| `AGENTS.md` | **Versionado.** É a fonte canônica de regras para agentes: 12 seções, incluindo regra de produção estável, nomes de branch, regras de commit, verificação obrigatória, expectativas de teste, ownership de conteúdo, guardrails de arquitetura e segurança de banco/deploy. |
| `CLAUDE.md` | **Versionado**, mas é apenas um ponteiro de compatibilidade. Diz explicitamente para não manter regras próprias e aponta para `AGENTS.md`, `README.md`, `docs/architecture/current.md` e `docs/operations/change-control.md`. |
| `DEVELOPER.md` | **Versionado** desde a PR #294 (20/08). Setup, workers, debug VS Code, verify, convenções de branch, troubleshooting. |
| `.claude/` | **Não versionado** — está no `.gitignore` (linha 13). 12 arquivos existem no disco da máquina do owner. Nenhuma configuração de agente é compartilhada pelo repositório. |
| `.superpowers/sdd/` | **Quase todo ignorado.** Apenas 5 arquivos de relatório de 3 ciclos de agosto estão versionados; os `progress.md` e os `review-*.diff` ficam de fora. |
| CODEX / Gemini / Copilot instructions | **Não existem.** |
| Configuração de MCP | **Não existe no repositório.** |
| Hooks de git ou de harness | **Não existem no repositório.** |

**Fato central:** hoje o repositório carrega *regras* para agentes
(`AGENTS.md`), mas **nenhuma infraestrutura executável** de agente. Tudo que é
configuração de agente vive fora do versionamento, na máquina do owner.

---

## Existing context/documentation system

71 arquivos em `docs/`. A organização atual:

| Diretório | Papel | Volume |
|---|---|---|
| `docs/architecture/` | arquitetura corrente e alvo, sources of truth, contrato de fidelidade de replay, superfície LLM outbound, diagramas | 10 arquivos |
| `docs/operations/` | runbooks: Lab, change control, segurança de banco de teste, baseline de migrations e performance, custo Vercel | 9 + os 3 desta sessão |
| `docs/ai-system/` | log dos ciclos da IA conversacional (C, D, F, G, H, I), corpus, freeze da V1 | 11 arquivos |
| `docs/superpowers/specs/` | designs por iniciativa | 12 |
| `docs/superpowers/plans/` | planos executáveis por iniciativa | 17 |
| `docs/product/` | **1 arquivo.** Foi consolidado. |
| `docs/compliance/` | LGPD healthcare | |

**Descontinuidade importante:** o repositório **abandonou ADRs**. Todos os
arquivos de `docs/architecture/adr/` foram apagados no commit `3115cefd`
*"docs: consolidate current architecture"* (06/08), junto com quase todo
`docs/product/`. O ADR-009 (Motor de Reativação), citado em handoffs, só existe
no histórico do git e na branch `feat/reativacao-motor`. Um Harness que assuma
"leia os ADRs" não encontrará nenhum.

O par **spec + plan** em `docs/superpowers/` é o formato vivo: cada iniciativa
tem um design e um plano, nomeados por data (`2026-08-17-...`).

**Um plano descreve o estado pretendido, não o estado real.** Uma varredura de
20/08 encontrou 8 planos citando caminhos que não existem no repositório — e na
maioria dos casos isso está certo, não é apodrecimento. Exemplo: o plano do Cycle
I cita `evals/cycle-i/human-review-r1.json` e `-r2.json`, que nunca foram criados
justamente porque os dois revisores humanos calibrados não existem — é a mesma
razão pela qual o gate termina em `NO_GO`. Um Harness que leia planos como
verdade corrente vai se enganar; os caminhos precisam ser conferidos contra a
árvore.

A varredura não encontrou nenhum link markdown quebrado em `docs/`.

---

## Existing execution infrastructure

- **76 scripts** em `scripts/`, quase todos `tsx`.
- **~40 npm scripts** já nomeando fluxos inteiros. Famílias que existem hoje:
  - `corpus:*` — export, sample, build, review, import, audit-pii (6)
  - `replay:*` — export, review, keys, approve, run, calendar, sandbox (7)
  - `lab:*` — sign-approval, config, verify, personas, evidence (5)
  - `eval:*` — intent, corpus, conversation-v2 cycle-i (3)
  - `db:*`, `verify*`, `seed*`, `demo:*`, `report:predicates`
- **CI**: `.github/workflows/ci.yml`. Roda **só em `pull_request`**, com
  `paths-ignore` para `docs/**` e `**/*.md`. Um único job `Verify` em Node 22 que
  executa `npm run verify`. Tem `concurrency` com `cancel-in-progress`.
  O arquivo documenta as próprias decisões e as medições que as motivaram.
- Outros workflows: `migration-ci.yml` (com guarda que recusa rodar contra o host
  de produção), `run-migration.yml`, `e2e-manual.yml` (`workflow_dispatch`,
  smoke/full), `conversation-insights.yml`, `github-pages.yml` (só em `main`).
- **Worktrees** são o padrão de isolamento estabelecido — 14 existiam antes do
  housekeeping de 20/08.
- **Tooling de dev** novo: `Makefile`, `scripts/dev-setup.sh`,
  `scripts/validate-env.sh`, `.vscode/launch.json` + `tasks.json`.

---

## Existing verification infrastructure

O comando canônico é um só, e `AGENTS.md` o define com precisão:

```bash
npm run verify   # db:check && lint && typecheck && test
```

`AGENTS.md` avisa explicitamente para **nunca** envolvê-lo em
`dotenv -e .env.local` — foi assim que testes de integração escreveram no banco
compartilhado. `npm run verify` roda deliberadamente sem banco, e os testes que
precisam de um são pulados. Para rodá-los de propósito existe `npm run test:db`,
com `.env.test.local` apontando para uma branch Neon de teste.

- **403 arquivos** em `src/__tests__/`; a suíte roda **3589 testes** (11 skipped)
  em ~40s.
- **12 guardas arquiteturais** em `src/__tests__/arch/`:
  `CapabilityContract`, `ConversationV2NoLiveExecution`,
  `ConversationV2RuntimeBoundary`, `CoordinatorBudget`, `CoreDomainLexicon`,
  `CoreImportBoundary`, `DentalPackBoundary`, `SystemOpsLabScope`,
  `TenantEngineRouterBoundary`, `V1ObservationSeamBoundary`,
  `V2ShadowWriteBoundary`, mais `domain-lexicon.json`.
- **48 arquivos** em `evals/`: `evals/corpus/` com **66 casos rotulados** em 19
  arquivos `.jsonl` por categoria (ambiguity, burst, injection, objection,
  price, silence-recovery, …), `baseline-v1.json`, `agreement-r1-r2.json` e um
  `CHANGELOG.md`. Mais `evals/cycle-i/`.
- `AGENTS.md` lista os tipos de mudança que **obrigam** teste: agenda/Calendar,
  webhook WhatsApp, transições de conversa, status de lead, contratos de banco e
  decisões de intenção/ação da IA. E declara: regra de negócio vive em código
  determinístico e testado, **não** em texto de playbook ou instrução de LLM.

> **Armadilha verificada:** a suíte exige árvore git limpa. Rodar `npm test` com
> arquivos staged e não commitados produz falhas com
> `Cycle I productive measurement requires a clean repository tree` — 32 falhas
> que não têm relação com o conteúdo. Qualquer Harness que rode testes precisa
> commitar antes, ou tratar esse erro como estado, não como regressão.

---

## Existing observability

`src/core/observability/` contém:

- `DecisionTrace.ts` — traço de decisão; existe `InMemoryDecisionTraceSink` para
  teste, e um cron `decision-trace-cleanup` em `vercel.json`;
- `V1TurnObservation.ts` + `V1TurnObservationBuilders.ts` — seam de observação da
  V1, com guarda arquitetural própria (`V1ObservationSeamBoundary`);
- `KeywordPredicateEvaluation.ts`, `KeywordPredicateRegistry.ts`,
  `NamedDecisionOverride.ts`.

Além disso: `docs/architecture/replay-and-decision-trace.md` e
`replay-fidelity-contract.md` descrevem o contrato; `lab:evidence` renderiza
evidência do Lab; a comparação shadow V1/V2 tem testes próprios
(`ConversationV2ComparisonProtocol`, `ConversationV2ShadowBatch`).

Sentry está presente via variáveis (`SENTRY_*`, `NEXT_PUBLIC_SENTRY_DSN`).

---

## Existing safety boundaries

Este é o ponto mais maduro do repositório e o que mais restringe um Harness.

- **Produção é `main`.** `develop` é integração. `AGENTS.md`: nunca empurrar
  direto para `main` exceto hotfix aprovado explicitamente.
- **Approval assinada por commit.** A ativação da V2 no Internal Lab depende de
  `CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON`, cujas claims citam o
  `commitSha` implantado. Deploy novo invalida. O modo de falha é **silencioso**:
  o Lab para de responder e o trace mostra
  `reason: "automation_not_live"`.
- **Fail-closed para V1.** Qualquer divergência mantém o tenant na V1.
- **Isolamento por tenant** com router dedicado
  (`TenantEngineRouter`) e guarda arquitetural (`TenantEngineRouterBoundary`,
  `SystemOpsLabScope`).
- **Segurança do banco de teste**: `docs/operations/test-database-safety.md`;
  `migration-ci.yml` recusa rodar se o host de teste for igual ao de produção.
- **Segredos**: `.gitignore` cobre `.env*` com exceção de `.env.example`. As
  chaves da authority do Lab ficam **fora do repositório**, e a private key só
  entra por `--private-key-file`, nunca por variável de ambiente.
- **Change control**: `docs/operations/change-control.md`.
- **Gate qualitativo honesto**: o Cycle I termina em `NO_GO` com
  `pending_human_review` **por design**, porque os dois reviewers humanos
  calibrados não existem. O runbook diz para voltar à V1 se alguém tentar
  reinterpretar `NO_GO` como aprovação.

---

## Existing handoff mechanisms

O que hoje permite um agente passar trabalho a outro:

1. **`AGENTS.md`** — regras estáveis, versionadas.
2. **Par spec + plan** em `docs/superpowers/` — 12 specs e 17 plans nomeados por
   data.
3. **Docs de handoff explícitos**, ex.:
   `docs/superpowers/plans/2026-08-13-overnight-handoff.md` e
   `2026-08-17-conversation-v2-internal-lab-live-handoff.md`.
4. **Log de ciclos** em `docs/ai-system/` — cada ciclo (C…I) tem seu fechamento
   escrito.
5. **Mensagens de commit longas e explicativas** — o repositório usa o corpo do
   commit como registro de decisão, não só rótulo.
6. **Runbooks operacionais** com precondition / expected / "retorna a V1 se" por
   seção.

Fora do versionamento, e portanto **indisponível a outro agente**: `.claude/`,
os `progress.md` do `.superpowers/sdd/`, e a memória local do assistente.

---

## Existing strengths

Apenas o que é verificável:

- Um comando de verificação único, canônico e documentado, que roda em ~40s e
  passa 3589 testes.
- 12 guardas arquiteturais executáveis — fronteiras não são convenção, são teste.
- Corpus rotulado (66 casos, 19 categorias) com baseline e medida de concordância
  entre revisores.
- Runbook operacional com estrutura repetível e condições de rollback
  explícitas por seção.
- Convenções de branch e commit descritas e seguidas na prática (30 dos últimos
  30 merges em `develop` são merge commits).
- CI que documenta as próprias decisões com as medições que as motivaram.
- Cultura de fail-closed: o caminho seguro é o comportamento padrão.

---

## Current gaps

Observáveis, sem propor solução:

1. **Nenhuma infraestrutura de agente é versionada.** `.claude/` está
   ignorado; não há MCP, hooks, nem skills no repositório. Cada agente novo
   começa do zero, com `AGENTS.md` como única herança.
2. **O formato de decisão morreu sem substituto nomeado.** ADRs foram apagados em
   `3115cefd`; `docs/architecture/current.md` absorveu parte, mas não há um lugar
   declarado para registrar decisões novas. Levantado em
   `decision-recording-today.md` — o gap continua aberto; só foi descrito.
3. ~~**O par spec/plan não tem índice.**~~ Endereçado em 20/08 por
   `document-status-index.md`, que classifica os 29 arquivos por evidência. É um
   índice **mantido à mão**, portanto envelhece — manter índice sincronizado é,
   ele próprio, um requisito para o Harness.
4. **A suíte exige árvore limpa** e falha de forma enganosa quando não está.
   Não há aviso no `AGENTS.md`.
5. **Handoff depende de prosa.** Não existe formato estruturado nem máquina de
   estado de handoff — o estado vive em documentos escritos à mão, e desatualiza
   silenciosamente.
6. **Estado local invisível.** Antes de 20/08 havia 15 commits e um script de 332
   linhas existindo só no disco. O repositório não tinha como detectar isso.
7. **Sem cobertura de CI para `push`.** CI roda só em `pull_request`; trabalho
   que nunca vira PR nunca é verificado.
8. **Gate qualitativo permanentemente pendente** por ausência de dois revisores
   humanos calibrados — é decisão consciente, mas bloqueia qualquer automação que
   dependa de `PASS`.

---

## Local-only state — o inventário do problema

Varredura de 2026-08-20 na worktree canônica. Nada disto foi versionado nem
apagado nesta sessão: o objetivo é dimensionar o problema que o Harness precisa
resolver, não improvisar solução.

| Item | Classe | Tamanho | Nota |
|---|---|---|---|
| `.env.local`, `.env.bak`, `.env.local.bak` | `SECRET` | ~15 KB | credenciais de produção; os dois `.bak` são cópias, mantidas por decisão do dono |
| `vitalli_messages.json`, `ximendes_messages.json`, `mensagens_operador_vitalli.txt`, `*_replay_results*`, `*_cases.json` | `SECRET` | ~840 KB | exports de conversa real de 23/07. Conferido: **zero números de telefone**; é texto de conversa |
| `public/dental.luxe98@gmail.com.ical.zip` | `SECRET` | 76 KB | export de agenda de cliente, com e-mail no nome do arquivo, dentro de `public/`. Está gitignorado, então **não é servido** — mas o diretório é o de estáticos do Next |
| `scripts/scratch/` | `UNKNOWN` | 9.2 MB, 44 `.ts` | scripts de uso único de investigações passadas, vários com prefixo `claude-`. Nunca promovidos, nunca descartados |
| `.claude/` | `PRIVATE_TOOL_CONFIG` | 144 KB, 12 arquivos | gitignorado por decisão |
| `.superpowers/brainstorm/` | `PRIVATE_TOOL_CONFIG` | 124 KB, 13 arquivos | idem |
| `reports/`, `tmp/`, `.site-build/`, `.vercel/`, `.DS_Store` | `DISPOSABLE` | ~1.3 MB | reconstruível |
| `.env.dev.example`, `.env.prod.example` | `REQUIRED_SOURCE` | ~1 KB | são exemplos e **não** estão versionados; provável candidato a versionar |

Fora do repositório, em `~/Dev/Projetos/_systemops-archive/`, há 9 JSONs de
backup de configuração de clínica (23/07), movidos deliberadamente para lá em
12/08 e explicados por um `MANIFESTO.md` no mesmo diretório. **São configuração
de tratamento e pipeline — preços, aliases, steps — e não dados de paciente**:
os campos são `pipelineSteps`, `priceCents`, `bookingWindows`, `aliases`. Por
checksum, apenas **um** par é duplicata exata
(`ximendes_lente_pipeline_backup_*`, hash `9782b554a842`); os dois arquivos
`vitalli_pipelines_backup*` têm o mesmo tamanho mas hashes diferentes. Nada foi
apagado: só a duplicata exata é comprovadamente redundante, e mesmo ela é
material de cliente que merece decisão humana.

## Identificadores de cliente no código versionado

Achado de 20/08, relevante para qualquer harness que envie contexto do
repositório a um provedor externo.

- Nomes de clínicas reais aparecem em **56** e **68** arquivos sob `src/`, e em
  13 e 9 arquivos sob `docs/`.
- **Nomes pessoais de leads reais** aparecem em 5 arquivos versionados:
  `XimendesConversationPatterns.test.ts`, `ResolveWhatsAppLead.test.ts`,
  `RegisterIncomingMessageRace.test.ts`, `AgentResponseThrottle.test.ts`, e um
  comentário em `src/application/calendar/import-calendar-events.ts`.
- A fixture `vitalli-agenda-exemplo.ts` versionada na raiz **é sintética**
  (João Silva, Maria Santos…) — essa está limpa.
- A branch `chore/investor-readiness` (PR #257, fechada sem merge) era
  exatamente a tentativa de sanitizar isso.

Não foi corrigido nesta sessão: a correção completa é o escopo daquela PR
fechada e precisa de decisão humana sobre até onde sanitizar. Corrigir 5
arquivos enquanto 100+ carregam identificadores daria falsa sensação de
resolvido.

## Candidate assets to reuse

Componentes existentes que provavelmente servem a um Harness futuro:

| Ativo | Por quê |
|---|---|
| `npm run verify` | já é o gate único e é rápido |
| `src/__tests__/arch/` (12 guardas) | fronteiras já executáveis |
| `evals/corpus/` + `eval:corpus` | avaliação já existe, com baseline e concordância |
| `replay:*` (7 comandos) | pipeline de replay sanitizado/aprovado já construído |
| `DecisionTrace` + `V1TurnObservation` | instrumentação de decisão já no lugar |
| Estrutura do `systemops-lab-runbook.md` | precondition / expected / rollback por seção é um formato de passo executável pronto |
| `AGENTS.md` | contrato de agente já escrito e respeitado |
| Convenção spec+plan | formato de planejamento já em uso |
| Worktrees | isolamento já é hábito da casa |
| Assinatura de approval por commit | modelo de attestation já implementado e testado |

---

## Risks before Harness

1. **A promoção `develop` → `main` está pendente** com 18 commits, incluindo
   mudança real de comportamento conversacional (PRs #290–#293). Enquanto não for
   feita, `main` e `develop` divergem e qualquer medição "em produção" mede código
   antigo.
2. **Refazer a approval é obrigatório após a promoção**, e esquecer isso deixa o
   Lab mudo sem erro.
3. **Duas branches com trabalho não mergeado e colisão de migration**
   (`chore/renomeia-operacao-custo`, `chore/investor-readiness`) aguardam decisão
   humana — ver `../operations/remote-branch-triage-2026-08-20.md`.
4. **Documentação superada não está marcada como tal.** Handoffs de agosto citam
   ADRs que não existem mais.
5. **O corpus é pequeno** — 66 casos rotulados. Suficiente para detectar
   regressão, frágil para afirmar melhoria.
6. Backups locais em `~/Dev/Projetos/_systemops-archive/` contêm 9 JSONs de
   configuração de clínica de uma limpeza anterior (12/08), que podem conter
   dados de cliente. Fora do repositório e fora do escopo desta sessão, mas
   convém revisar.

---

## Canonical files for an external Harness architect to read

Em ordem. Os cinco primeiros bastam para entender as restrições.

0. `docs/engineering/HARNESS-DESIGN-INPUT.md` — a especificação do problema.
   Se você só vai ler um arquivo antes de desenhar, é este.
1. `AGENTS.md` — o contrato de agente. Regras de verificação, teste, branch e
   guardrails.
2. `docs/architecture/current.md` — o que o sistema é hoje.
3. `docs/operations/systemops-lab-runbook.md` — o formato de passo executável
   mais maduro do repositório, e as regras de approval. Ler ao menos as seções
   13, 16, 18–21, 21-A e 23.
4. `docs/architecture/sources-of-truth.md` — onde cada tipo de informação vive.
5. `docs/operations/change-control.md` — o que exige aprovação.
6. `docs/architecture/replay-fidelity-contract.md` e
   `replay-and-decision-trace.md` — o contrato de observabilidade/replay.
7. `src/__tests__/arch/` — as fronteiras que já são executáveis.
8. `docs/ai-system/cycle-i-shadow-comparison.md` — como a comparação V1/V2 é
   medida, e por que o gate termina em `NO_GO`.
9. `package.json` (bloco `scripts`) — o vocabulário de execução existente.
10. `.github/workflows/ci.yml` — o gate automatizado e as decisões por trás dele.
11. `docs/engineering/document-status-index.md` — o que é ativo e o que é
    história, com a evidência de cada classificação.
12. `docs/engineering/decision-recording-today.md` — onde as decisões vivem hoje,
    e o que se perdeu quando os ADRs foram apagados.
