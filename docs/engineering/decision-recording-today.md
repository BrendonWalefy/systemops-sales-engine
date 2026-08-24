# Onde as decisões de arquitetura vivem hoje

Levantamento factual feito em 2026-08-20. **Não escolhe formato futuro.** A
decisão entre ADR, decision-log, grafo ou outra coisa pertence ao design do
Harness.

## O que aconteceu com os ADRs

O repositório usou ADRs numerados (`docs/architecture/adr/`, pelo menos até o
ADR-009). Todos foram apagados num único commit:

```
3115cefd  docs: consolidate current architecture   (2026-08-06)
```

O mesmo commit esvaziou quase todo `docs/product/`. Hoje **não existe nenhum
arquivo de ADR na `develop`** — nem o diretório. O conteúdo foi absorvido por
`docs/architecture/current.md` e `target-architecture.md`.

Isso resolveu duplicação, e criou um buraco: a consolidação preservou o
**resultado** das decisões, não o **raciocínio** delas. Um ADR registra
alternativas consideradas e por que foram descartadas. `current.md` descreve o
que o sistema é.

Nenhum formato foi declarado como substituto.

## Os seis formatos que existem hoje

Em ordem aproximada de autoridade.

### 1. `AGENTS.md` — canônico de fato para regra operacional

É o único documento que se declara vinculante e é respeitado na prática.
Auditado em 20/08: todos os comandos e caminhos citados existem. Registra
regras, não raciocínio.

### 2. `docs/architecture/current.md` + `target-architecture.md` + `sources-of-truth.md`

Canônico para "o que o sistema é" e "para onde vai". Descritivo. Não guarda
alternativas descartadas.

### 3. Spec + plan em `docs/superpowers/`

12 specs e 17 plans. **É o formato mais próximo de um ADR hoje.** Um spec abre
com `## 1. Decisão` e segue com `## 2. O problema, com evidência` — a estrutura
de um ADR sem o nome.

Duas limitações reais:

- só **um** dos 12 specs declara status próprio;
- plans descrevem estado pretendido, e envelhecem sem aviso (ver
  `document-status-index.md`).

### 4. Runbooks em `docs/operations/`

O `systemops-lab-runbook.md` é o formato mais maduro do repositório: cada seção
tem **precondition / expected / "retorna a V1 se"**. É passo executável com
condição de rollback explícita. Guarda decisões operacionais melhor do que
qualquer outro artefato aqui — mas só cobre operação, não desenho.

### 5. Comentário de código com justificativa e medição

**43 arquivos sob `src/` citam `docs/`**, e vários carregam a decisão junto do
código que ela governa. Exemplo, em `src/core/scheduling/BusinessSchedule.ts`:

> Este módulo é a porta ÚNICA de leitura da escala. Nada deve ler
> `business_hours` nem chamar parseBusinessHours direto para decidir dia.
> Ver docs/superpowers/specs/2026-08-13-per-day-business-hours-design.md

O `.github/workflows/ci.yml` faz o mesmo com 14 linhas de comentário que
explicam por que o CI roda só em `pull_request`, **com as medições que
motivaram** ("17 dos últimos 40 PRs mergeados tocavam apenas `docs/`"). O
`migration-ci.yml` tem 13 linhas semelhantes.

Esse é, na prática, o formato mais confiável do repositório: fica ao lado do
código, então não desatualiza em silêncio.

### 6. Corpo de commit

Medição sobre os últimos 50 commits da `develop`: **corpo médio de 11 linhas, e
28 dos 50 com mais de 10 linhas.** Não são rótulos; são registros.

## Onde há lacuna real

**Decisão que só existe em commit, e não é alcançável por busca em `docs/`.**

O caso mais claro encontrado nesta sessão é o commit único de
`chore/renomeia-operacao-custo` (PR #232, fechada sem merge). O corpo dele
carrega, e é o único lugar que carrega:

- a medição que justifica a mudança — 871 registros e US$ 2,45, "mais que a
  feature de reativação inteira";
- a constatação de que `analyze-sales-conversation` não tem nenhum chamador e
  `agent_recommendations` está vazia;
- **um gotcha operacional de migração**: o `drizzle-kit` gerou
  `DROP TYPE + CREATE TYPE + cast`, que falharia, porque no momento do cast as
  871 linhas ainda conteriam o valor antigo, ausente do tipo recriado. A saída
  foi `ALTER TYPE RENAME VALUE`, atômico e preservando a posição ordinal;
- a validação numa cópia do banco com dados reais.

Nada disso está em `docs/`. Está no corpo de um commit de uma branch cuja PR foi
fechada. Uma busca por "como renomear um valor de enum com segurança" não acha.

Outros exemplos da mesma classe:

- **ADR-009 (Motor de Reativação)** — só no histórico do git e na branch
  `feat/reativacao-motor`;
- **decisões de CI** — vivem só no comentário do workflow, que é um bom lugar,
  mas invisível para quem procura em `docs/`;
- **`docs/architecture/decision-ownership.md`** — o spec de 13/08 cita esse
  artefato como saída da auditoria de ownership. O código associado existe; o
  documento nunca foi criado.

## Resumo factual

| Pergunta | Resposta hoje |
|---|---|
| Existe formato declarado para decisão de arquitetura? | **Não**, desde `3115cefd` |
| Qual formato é canônico de fato? | `AGENTS.md` para regra; spec+plan para desenho |
| Qual é o mais confiável? | comentário de código com medição — não desatualiza calado |
| Qual é o mais estruturado? | seções do runbook (precondition / expected / rollback) |
| Onde há perda? | raciocínio, alternativas descartadas e gotchas operacionais que só existem em corpo de commit e em branches não mergeadas |
| Existe índice de status? | Só a partir de 20/08: `document-status-index.md` |

## Explicitamente não decidido aqui

ADR vs decision-log vs grafo; se decisão deve viver junto do código ou em
diretório próprio; se precisa de índice gerado; se o Harness deve extrair
decisão de commit automaticamente. **Tudo isso é input para o design, não
conclusão dele.**
