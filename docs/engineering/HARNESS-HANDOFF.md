# Harness — handoff

Mapa factual para um agente ou arquiteto que chega agora. Objetivo da próxima
sessão: **desenhar o Harness Engineering do SystemOps.** Nada de Harness foi
implementado ainda, de propósito.

Escrito em 2026-08-20. Confira os HEADs antes de confiar nos números.

## O que é o SystemOps

Plataforma de inteligência comercial que opera pelo WhatsApp: recebe a mensagem,
identifica a intenção do lead, aplica a estratégia da organização, conduz até o
agendamento e devolve isso como contexto operacional. A equipe supervisiona
exceções pelo Inbox.

O princípio que governa o código inteiro:

> **O LLM entende e verbaliza. O sistema decide.**

Modelos classificam intenção, transcrevem áudio e compõem texto. Código
determinístico decide tenant, autorização, disponibilidade, booking, estado,
handoff, retry, limites e envio. `AGENTS.md` reforça: regra de negócio vive em
código testado, **nunca** em texto de playbook ou instrução de LLM.

## Estado da V1 / V2

- **V1** é o motor conversacional em produção. Está **congelada**:
  `docs/ai-system/v1-freeze.md`, SHA `154a1263`, tag anotada `v1-frozen`. É o
  ponto de retorno.
- **V2** (`src/conversation-core/` + `src/domain-packs/`) é o reset em curso.
  Passou pelos ciclos A→I, documentados em `docs/ai-system/`. Está ativa
  **somente no Internal Lab**, um tenant de teste, e **fail-closed para V1** em
  qualquer divergência.
- A V2 mais recente (verbalização, PRs #290–#293) está em `develop` e **ainda não
  foi promovida** para produção.

## HEADs

| | |
|---|---|
| `main` (produção) | `0d0015cf` |
| `develop` (integração) | `7b624c83` |
| divergência | 0 / 18 |
| V1 congelada | `154a1263`, tag `v1-frozen` |

## Produção

`main` deploya via Vercel para `app.systemops.com.br`. `vercel.json` registra 22
crons (workers de mensagem e envio, sweeps, campanhas, agregações).

**Não promova `develop` para `main` sem ler**
`docs/operations/develop-to-main-promotion-plan.md`. A approval do Lab é assinada
contra o commit implantado; um deploy novo a invalida e **o Lab para de responder
sem emitir erro**.

## Branch strategy

- `main` = produção, nunca push direto (exceto hotfix aprovado);
- `develop` = integração, destino de toda PR;
- `feat/<área>-<mudança>`, `fix/<área>-<bug>`, `chore/<área>-<tarefa>`,
  `docs/<assunto>`;
- merge commits, não squash (30 dos últimos 30 merges);
- worktrees são o padrão de isolamento.

## Invariantes que não se negociam

1. O sistema decide, o LLM verbaliza.
2. Fail-closed para V1. O caminho seguro é o comportamento padrão.
3. Approval vinculada ao commit implantado.
4. Isolamento por tenant, com guarda arquitetural executável.
5. `npm run verify` **sem** `dotenv -e .env.local` — envolver assim já fez teste
   de integração escrever no banco compartilhado. Ver
   `docs/operations/test-database-safety.md`.
6. Segredos nunca no repositório; private key da authority só por
   `--private-key-file`.

## Comandos de verificação

```bash
npm run verify        # db:check + lint + typecheck + test  (~40s)
npm run test:db       # integração, exige .env.test.local numa branch Neon de teste
npm run verify:agenda # suíte de agenda/timezone
```

Baseline atual em `develop`: **399 arquivos, 3589 testes, 11 skipped, 0 falhas.**

> A suíte exige **árvore git limpa**. Com arquivos staged e não commitados ela
> falha com `Cycle I productive measurement requires a clean repository tree` —
> 32 falhas sem relação com o conteúdo. Commite antes de testar.

## Onde as coisas ficam

| O quê | Onde |
|---|---|
| Regras para agentes | `AGENTS.md` (canônico); `CLAUDE.md` é só um ponteiro |
| Arquitetura | `docs/architecture/current.md`, `target-architecture.md`, `sources-of-truth.md` |
| Runbooks | `docs/operations/` — o do Lab é o mais maduro |
| Ciclos da IA conversacional | `docs/ai-system/` (C…I) |
| Specs e planos | `docs/superpowers/specs/` (12) e `plans/` (17) |
| Evals e corpus | `evals/corpus/` — 66 casos rotulados em 19 categorias |
| Guardas arquiteturais | `src/__tests__/arch/` — 12 testes |
| Observabilidade | `src/core/observability/` — DecisionTrace, V1TurnObservation |
| Núcleo V2 | `src/conversation-core/`, `src/domain-packs/` |

## O que NÃO assumir

- **Não existem ADRs.** Todos foram apagados em `3115cefd` (06/08). Handoffs
  antigos ainda os citam. `docs/product/` também foi consolidado e tem 1 arquivo.
- **Não existe infraestrutura de agente versionada.** `.claude/` está no
  `.gitignore`; não há MCP, hooks ou skills no repositório. `AGENTS.md` é a
  única herança entre agentes.
- **Não assuma que branch não-ancestral de `main` = trabalho perdido.** A maioria
  teve PR mergeada e o tip virou snapshot morto. Use
  `git cherry origin/develop origin/<branch>`.
- **Não interprete `NO_GO` do Cycle I como falha.** É o resultado correto: os dois
  revisores humanos calibrados não existem, e nenhuma authority local promove
  esse estado.
- **Não assuma CI em `push`.** CI roda só em `pull_request`, ignorando
  `docs/**` e `**/*.md`.
- **Não confie no corpus para afirmar melhoria.** 66 casos detectam regressão;
  são frágeis para provar ganho.

## Riscos abertos

1. Promoção `develop` → `main` pendente, com mudança real de comportamento.
2. Duas branches com trabalho não mergeado e colisão de número de migration,
   aguardando decisão humana:
   `docs/operations/remote-branch-triage-2026-08-20.md`.
3. Documentação superada não está marcada como tal.
4. Estado local invisível: até 20/08 havia trabalho existindo só no disco.

## Ler primeiro, nesta ordem

1. `AGENTS.md`
2. `docs/engineering/harness-readiness-2026-08-20.md` — o inventário completo
   que acompanha este mapa
3. `docs/architecture/current.md`
4. `docs/operations/systemops-lab-runbook.md` (seções 13, 16, 18–21, 21-A, 23)
5. `docs/operations/develop-to-main-promotion-plan.md`
