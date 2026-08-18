# Congelamento da V1 da inteligência conversacional

Data: 2026-08-15
Ciclo: A do [plano da Conversation Intelligence V2](../superpowers/plans/2026-08-15-conversation-intelligence-v2.md)

Este documento registra o ponto de retorno do programa de reset. Enquanto a V2 não for
promovida, é ele que responde "para onde eu volto se der errado".

## SHA congelado

| Item | Valor |
| --- | --- |
| SHA da V1 congelada | `154a126399cfe54f3d62d41be2408a0021b187c2` |
| Tag anotada | `v1-frozen` (objeto `b8940c3e87c51de1bc580acd4cd2aff4ecd82445`) |
| Commit | `Merge pull request #277 from BrendonWalefy/docs/conversation-intelligence-v2` |
| Publicada em | `origin` |

## Baseline de testes

Saída literal de `npm run verify` no SHA congelado, reproduzida a partir da tag em worktree
detached limpa:

```
 Test Files  278 passed (278)
      Tests  2541 passed | 10 skipped (2551)
   Duration  30.42s
```

Os 10 skipped são testes de integração que exigem `DATABASE_URL`. O `verify` canônico do
repositório não carrega `.env.local`, então eles são pulados por padrão — ver a ressalva abaixo.

## Como se chegou aqui

Dois PRs, deliberadamente separados para que a correção de runtime não esperasse a revisão da
documentação:

| PR | Escopo | Commits | Checks |
| --- | --- | --- | --- |
| [#276](https://github.com/BrendonWalefy/systemops-sales-engine/pull/276) | código — reparo de estilo do composer e trace de violation codes | `59ed78b`, `d6730d5` | Verify 2m19s, Vercel — verdes |
| [#277](https://github.com/BrendonWalefy/systemops-sales-engine/pull/277) | documentação — auditoria, spec e plano da V2 | `956f34a`, `ef4684d`, `877d28b`, `d1cc59e` | Vercel verde; `Verify` não roda em PR só de `docs/` por `paths-ignore` em `ci.yml` |

## Bundle físico

```
~/Dev/Projetos/_systemops-archive/pre-v2-reset-20260815.bundle
```

42 MB. Validado com `git bundle verify` → *"The bundle records a complete history"*. Contém
`refs/heads/main` em `154a126` e `refs/tags/v1-frozen`.

## Worktree da V2

| Item | Valor |
| --- | --- |
| Caminho | `/Users/brendonwalefy/Dev/Projetos/systemops-sales-engine-v2` |
| Branch | `feat/conversation-core-v2` |
| SHA inicial | `154a126` — idêntico a `v1-frozen` |

O caminho segue o padrão das outras worktrees do repositório (`systemops-sales-engine-*`) em vez
do `../systemops-v2` que o plano previa.

## Regra da V1 congelada

A partir deste ponto a V1 recebe **apenas correção crítica**: o necessário para manter os testes
verdes, para não quebrar produção, ou para permitir a comparação V1 × V2.

Regra conversacional nova **não entra na V1**. Bug encontrado na V1 vira:

```
bug real → caso no corpus → caso de regressão → requisito da V2
```

e não um `if` novo no `ConversationOrchestrator`. Essa é a razão de o congelamento existir.

## Rollback

Provado, não presumido. Reproduzido em 15/08 a partir apenas da tag:

```bash
git worktree add --detach /tmp/rollback-proof v1-frozen
cd /tmp/rollback-proof && npm ci && npm run verify
# → 278 arquivos, 2.541 testes, 10 skipped
git worktree remove /tmp/rollback-proof
```

A demonstração usa worktree **temporária e detached** de propósito: a worktree permanente da V2
nunca é apontada para `v1-frozen`, para não depender de alguém lembrar de voltá-la depois.

Em produção, o rollback da V2 não é `git revert` — é mudar o seletor de versão de conversa para
`v1`. A V1 permanece o caminho default até o Ciclo J.

## Ressalva encontrada no Ciclo A

`src/__tests__/calendar-import.test.ts` falha quando os testes de integração rodam contra o banco
compartilhado, com `expected 'b3df789a…' to be '3f963948…'` na resolução de profissional.

Causa: o teste insere dois `professionals` a cada execução e o `afterAll` declara explicitamente
que não limpa — *"Cleanup após testes (opcional — manter dados para inspecionar)"*. Acumularam
**8 duplicatas de cada** na clínica `demo-vitalli-test`, a primeira de **09/07**, e a resolução do
profissional default passou a escolher outra linha.

Estado verificado:

- a falha **existe igualmente em `origin/main`** sem qualquer mudança do programa V2;
- **não** aparece no `verify` canônico, porque sem `DATABASE_URL` esses testes são pulados;
- o resíduo está confinado à clínica de teste `demo-vitalli-test`, que tem 0 conversas;
- os tenants reais estão intactos e conferem com a medição do início do programa — Vitalli
  1.030 conversas / 12.460 mensagens, NC Beauty 160 / 2.318, Ximendes 81 / 2.139, Maycon
  bordados 78 / 1.761.

Nada foi apagado do banco. Entra como item do Ciclo B: o teste precisa limpar o que cria, ou
criar tenant efêmero por execução.
