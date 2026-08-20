# Índice de status da documentação

Este índice existe por um motivo estreito: **impedir que um agente leia um plano
e ache que está lendo o estado atual do sistema.**

Ele não reescreve nada. Documento histórico continua histórico. O índice diz o
que cada documento é hoje, e onde está a verdade quando o documento já não é ela.

Levantado em 2026-08-20 contra `develop`. Classificação por evidência
verificável — quando não há prova, o status é `UNKNOWN`, não um palpite.

## Vocabulário

| Status | Significado |
|---|---|
| `ACTIVE` | descreve o estado atual, ou é trabalho em curso |
| `COMPLETED` | foi executado; os artefatos existem no código |
| `HISTORICAL` | registro de um momento; correto para a data, não para hoje |
| `SUPERSEDED` | outro documento ou outro código ocupou o lugar |
| `PLANNED_NOT_IMPLEMENTED` | descreve artefato que não existe no repositório |
| `BLOCKED` | executado até onde dava; parado por dependência externa |
| `UNKNOWN` | não foi possível provar o status |

**Regra de leitura:** só `ACTIVE` pode ser tratado como verdade corrente. Todo o
resto exige conferir o código.

---

## Arquitetura — `docs/architecture/`

| Arquivo | Status | Observação |
|---|---|---|
| `current.md` | `ACTIVE` | Fonte de verdade da arquitetura. Absorveu os ADRs em `3115cefd`. |
| `target-architecture.md` | `ACTIVE` | Estado alvo, explicitamente futuro. |
| `sources-of-truth.md` | `ACTIVE` | Onde cada tipo de informação vive. |
| `replay-fidelity-contract.md` | `ACTIVE` | Contrato do replay. |
| `replay-and-decision-trace.md` | `ACTIVE` | Contrato de observabilidade. |
| `llm-outbound-surface.md` | `ACTIVE` | Superfície de saída da LLM. |
| `cycle-g-authorized-reads.md` | `ACTIVE` | Leituras autorizadas; sustenta a guarda `CapabilityContract`. |

**`docs/architecture/adr/` não existe.** Todos os ADRs foram apagados em
`3115cefd` (*"docs: consolidate current architecture"*, 06/08), incluindo o
ADR-009 do Motor de Reativação. Só existem no histórico do git e em branches
antigas. Ver `decision-recording-today.md`.

## Ciclos da IA conversacional — `docs/ai-system/`

Registro por ciclo. São **relatórios de fechamento**: descrevem o que foi medido
naquele ciclo, não o estado de hoje.

| Arquivo | Status | Evidência |
|---|---|---|
| `v1-freeze.md` | `ACTIVE` | Define o ponto de retorno. SHA `154a1263`, tag `v1-frozen` — a tag existe. |
| `cycle-c-closure-and-d0.md` | `HISTORICAL` | fechamento do ciclo C |
| `cycle-d-keyword-predicates.md` | `COMPLETED` | `KeywordPredicateRegistry.ts` e `KeywordPredicateEvaluation.ts` existem |
| `cycle-f-dental-domain-pack.md` | `COMPLETED` | `src/domain-packs/dental/` existe |
| `cycle-g-capabilities.md` | `COMPLETED` | `src/conversation-core/capability/` existe |
| `cycle-h-composer-validator.md` | `COMPLETED` | `src/conversation-core/composer/validator.ts` existe; tag `cycle-h-closed-99a852aa` |
| `cycle-i-shadow-comparison.md` | `BLOCKED` | `evals/cycle-i/` existe e o gate reporta `NO_GO` **por design** — faltam dois revisores humanos calibrados. Não é falha. |
| `corpus-baseline-and-findings.md` | `HISTORICAL` | baseline medido; o corpus evoluiu |
| `corpus-review-guide.md` | `ACTIVE` | procedimento de revisão, ainda válido |
| `corpus-unanswered-and-other.md` | `HISTORICAL` | achados de um recorte |
| `audit.md` | `HISTORICAL` | auditoria conversacional |

## Specs — `docs/superpowers/specs/`

Um spec descreve a decisão de desenho de uma iniciativa.

| Arquivo | Status | Evidência / observação |
|---|---|---|
| `2026-08-09-systemops-rebuild-design.md` | `ACTIVE` | O único com status próprio: *"aprovado pelo usuário em 2026-08-09"*. É o desenho mestre. |
| `2026-08-12-intent-eval-harness-design.md` | `COMPLETED` | `scripts/eval-intent.ts` + `npm run eval:intent` |
| `2026-08-13-labeled-corpus-growth-design.md` | `COMPLETED` | `evals/corpus/cases/` com 19 categorias |
| `2026-08-13-per-day-business-hours-design.md` | `COMPLETED` | `src/core/scheduling/BusinessSchedule.ts` + migration `0098`. O módulo cita o spec de volta. |
| `2026-08-13-prose-judge-design.md` | `COMPLETED` | implementado em `scripts/eval-corpus.ts --judge`, e o próprio código marca **"EXPERIMENTAL, NÃO É GATE"** |
| `2026-08-13-decision-ownership-audit-design.md` | `ACTIVE` | Parcial. O registry (`NamedDecisionOverride.ts`, `KeywordPredicateRegistry.ts`) e `npm run report:predicates` existem, mas o artefato `docs/architecture/decision-ownership.md` que o spec cita **nunca foi criado**. O spec prevê retiradas incrementais, cada uma num PR próprio. |
| `2026-08-15-conversation-intelligence-v2-design.md` | `ACTIVE` | desenho do programa V2 em curso |
| `2026-08-16-...-cycle-g-design.md` | `COMPLETED` | ver ciclo G |
| `2026-08-16-...-cycle-h-design.md` | `COMPLETED` | ver ciclo H |
| `2026-08-16-...-cycle-h-hardening-design.md` | `COMPLETED` | ver ciclo H |
| `2026-08-16-...-cycle-i-design.md` | `BLOCKED` | ver ciclo I |
| `2026-08-17-conversation-v2-internal-lab-live-design.md` | `ACTIVE` | o Lab está ativo em `operationalStatus=test` |

## Plans — `docs/superpowers/plans/`

> **Aviso que vale para a pasta inteira:** um plano descreve o estado
> **pretendido**. Uma varredura de 20/08 encontrou 8 planos citando caminhos que
> não existem no repositório, e na maioria dos casos isso está **certo** — o
> plano propôs artefatos que mudaram de nome ou nunca foram criados. O exemplo
> mais claro: o plano do Cycle I cita `evals/cycle-i/human-review-r1.json` e
> `-r2.json`, que não existem exatamente pela razão que faz o gate reportar
> `NO_GO`. **Nunca leia um plano como inventário.**

| Arquivo | Status |
|---|---|
| `2026-08-09-conversation-reliability-foundation.md` | `COMPLETED` |
| `2026-08-09-phase-3a-incremental-read-paths.md` | `COMPLETED` |
| `2026-08-09-systemops-lab-performance-baseline.md` | `COMPLETED` |
| `2026-08-12-intent-eval-harness.md` | `COMPLETED` |
| `2026-08-12-intent-eval-baseline-report.md` | `HISTORICAL` |
| `2026-08-13-classifier-model-comparison.md` | `HISTORICAL` |
| `2026-08-13-core-validation-plan.md` | `COMPLETED` |
| `2026-08-13-core-validation-results.md` | `HISTORICAL` |
| `2026-08-13-overnight-handoff.md` | `HISTORICAL` |
| `2026-08-15-conversation-intelligence-v2.md` | `ACTIVE` |
| `2026-08-16-...-cycle-f.md` | `COMPLETED` |
| `2026-08-16-...-cycle-g.md` | `COMPLETED` |
| `2026-08-16-...-cycle-h.md` | `COMPLETED` |
| `2026-08-16-...-cycle-h-hardening.md` | `COMPLETED` |
| `2026-08-16-...-cycle-i.md` | `BLOCKED` |
| `2026-08-17-conversation-v2-internal-lab-live.md` | `COMPLETED` |
| `2026-08-17-conversation-v2-internal-lab-live-handoff.md` | `HISTORICAL` |

Os dois `-handoff` são snapshots de passagem de turno. Úteis como narrativa,
**não** como estado.

## Operações — `docs/operations/`

| Arquivo | Status | Observação |
|---|---|---|
| `systemops-lab-runbook.md` | `ACTIVE` | Runbook canônico. Seção 21-A é obrigatória antes de qualquer deploy. |
| `change-control.md` | `ACTIVE` | |
| `test-database-safety.md` | `ACTIVE` | Referenciado pelo `AGENTS.md`. |
| `migrations-baseline.md` | `ACTIVE` | |
| `performance-baseline.md` | `HISTORICAL` | baseline medido numa data |
| `staging-ci-setup.md` | `UNKNOWN` | não foi possível provar se o staging descrito ainda existe |
| `vercel-pro-spend-control.md` | `ACTIVE` | |
| `onboarding-clinica.md` | `ACTIVE` | |
| `develop-to-main-promotion-plan.md` | `ACTIVE` | Snapshot de HEADs; o próprio documento manda resolver em runtime. |
| `remote-branch-triage-2026-08-20.md` | `HISTORICAL` | Triagem de 20/08. Revalidar com `git cherry` antes de agir. |
| `repository-housekeeping-2026-08-20.md` | `HISTORICAL` | Registro de sessão. Os SHAs são da data. |

## Raiz e engenharia

| Arquivo | Status | Observação |
|---|---|---|
| `AGENTS.md` | `ACTIVE` | Contrato canônico de agente. Auditado em 20/08: todos os comandos e caminhos resolvem. |
| `CLAUDE.md` | `ACTIVE` | Apenas ponteiro, por desenho. |
| `README.md` | `ACTIVE` | |
| `DEVELOPER.md` | `ACTIVE` | |
| `docs/engineering/harness-readiness-2026-08-20.md` | `ACTIVE` | Inventário pré-Harness. |
| `docs/engineering/HARNESS-HANDOFF.md` | `ACTIVE` | Mapa de entrada. |
| `docs/engineering/HARNESS-DESIGN-INPUT.md` | `ACTIVE` | Especificação do problema do Harness. |
| `docs/engineering/document-status-index.md` | `ACTIVE` | este arquivo |
| `docs/engineering/decision-recording-today.md` | `ACTIVE` | onde decisões vivem hoje |
| `docs/product/campanha-modo-overlay-ideia.md` | `UNKNOWN` | Ideia de 12/08, nunca aceita nem rejeitada. Já traz nota sobre o ADR-009 removido. |

## O que este índice não faz

Não classifica commits, nem mensagens de commit, nem o conteúdo de branches
antigas. Uma parte real do raciocínio de decisão do projeto vive nesses lugares —
é justamente o gap descrito em `decision-recording-today.md`.
