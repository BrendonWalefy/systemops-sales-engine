# Harness — handoff

Mapa de entrada para quem chega agora. Objetivo da próxima sessão: **desenhar o
Harness Engineering do SystemOps.** Nada de Harness foi implementado, de
propósito.

Leia isto, depois `HARNESS-DESIGN-INPUT.md`. Os dois somam ~20 minutos.

## O produto em cinco linhas

Plataforma de inteligência comercial que opera pelo WhatsApp: recebe a mensagem,
identifica a intenção do lead, aplica a estratégia da clínica, conduz até o
agendamento. Clientes reais, dinheiro real.

O princípio que governa o código:

> **O LLM entende e verbaliza. O sistema decide.**

Regra de negócio vive em código determinístico e testado — nunca em texto de
playbook ou instrução de modelo.

## Resolva o estado em runtime, não neste documento

Qualquer SHA escrito em documentação envelhece. Rode:

```bash
git fetch origin --prune
git rev-parse origin/main origin/develop
git rev-list --left-right --count origin/main...origin/develop
```

Em 2026-08-20: `main` = `0d0015cf` (**é o commit em produção**, confirmado pela
API de deployments), `develop` = `3833eab7`, divergência 0/26, 3 worktrees
limpas, nenhuma PR aberta.

## V1 e V2

- **V1** é o motor em produção, e está **congelada**: `docs/ai-system/v1-freeze.md`,
  SHA `154a1263`, tag `v1-frozen`. É o ponto de retorno.
- **V2** (`src/conversation-core/`, `src/domain-packs/`) é o reset em curso.
  Ciclos A→I documentados em `docs/ai-system/`. Ativa **somente no Internal
  Lab**, um tenant de teste, e **fail-closed para V1**.
- A V2 mais recente (verbalização, PRs #290–#293) está em `develop` e **não foi
  promovida**.

## As invariantes que não se quebram

1. O sistema decide, o LLM verbaliza.
2. `main` é produção; `develop` é integração; nunca push direto em `main`.
3. Fail-closed para V1.
4. A approval do Lab é assinada **contra o commit implantado**. Deploy novo a
   invalida, e o Lab **para de responder sem emitir erro**. Runbook §21-A.
5. `npm run verify` **nunca** dentro de `dotenv -e .env.local`.
6. Segredo nunca no repositório.
7. `NO_GO` no gate do Cycle I não é reinterpretável.

## Verificação

```bash
npm run verify        # db:check + lint + typecheck + test  (~40s)
```

Baseline em `develop`: **399 arquivos, 3589 testes, 11 skipped, 0 falhas.**

> A suíte exige **árvore git limpa**. Com arquivos staged e não commitados ela
> produz 32 falhas sem relação com a mudança. Commite antes de verificar. Já
> está no `AGENTS.md`.

CI roda **só em `pull_request`**, ignorando `docs/**` e `**/*.md`.

## Onde ler o quê

| Pergunta | Arquivo |
|---|---|
| Quais são as regras para agentes? | `AGENTS.md` |
| Qual é o problema que o Harness resolve? | `HARNESS-DESIGN-INPUT.md` |
| O que já existe para reaproveitar? | `harness-readiness-2026-08-20.md` |
| Este documento está atual ou é história? | `document-status-index.md` |
| Onde vivem as decisões de arquitetura? | `decision-recording-today.md` |
| Como promover sem calar o Lab? | `../operations/develop-to-main-promotion-plan.md` |
| Essa branch antiga serve? | `../operations/remote-branch-triage-2026-08-20.md` |

## O que NÃO assumir

- **Não existem ADRs.** Todos apagados em `3115cefd` (06/08). Documentos
  escritos *depois* ainda os citam.
- **Não existe infraestrutura de agente versionada.** `.claude/` está no
  `.gitignore`; sem MCP, hooks ou skills. `AGENTS.md` é a única herança.
- **Plano ≠ estado.** 8 planos citam caminhos inexistentes, e na maioria dos
  casos isso está certo — eles descrevem intenção.
- **Branch não-ancestral de `main` ≠ trabalho perdido.** Use
  `git cherry origin/develop origin/<branch>`.
- **`NO_GO` do Cycle I não é falha.** Os dois revisores humanos calibrados não
  existem; é o resultado correto.
- **Não confie no corpus para afirmar melhoria.** 66 casos detectam regressão.

## Riscos abertos

1. Promoção `develop` → `main` pendente, com mudança real de comportamento.
2. Bug de isolamento multi-tenant conhecido e **não corrigido**: nome de cliente
   hardcoded na escolha de profissional padrão. Ver a triagem de branches.
3. Identificadores de cliente espalhados por 100+ arquivos versionados —
   relevante para qualquer harness que envie contexto a um provedor externo.
4. Estado local invisível: 9.2 MB de scripts de uso único e ~840 KB de exports
   de conversa fora do versionamento.
5. **A rede de proteção da V2 tem prazo.** Hoje a resposta para "e se a V2
   errar?" é cair para a V1. O passo 7 da Estratégia Strangler remove a V1, e
   nenhum documento diz o que entra no lugar. Ver "Perguntas em aberto herdadas
   do produto" em `HARNESS-DESIGN-INPUT.md`.
