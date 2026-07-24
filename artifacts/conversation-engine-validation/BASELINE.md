# Baseline da validação

Data: 24/07/2026
Modo: descoberta read-only do produto; sem alteração de comportamento, schema ou configuração.

## Isolamento

- Worktree: `/Users/brendonwalefy/Dev/Projetos/systemops-sales-engine-v1-v2-validation`
- Branch: `chore/conversation-engine-validation`
- Base atual: `origin/develop@d8c0fd0c7602fe635601afeb0778b1f982301fc7`
- Produção auditada: `origin/main@d8c0fd0c7602fe635601afeb0778b1f982301fc7`
- Worktree original de `main`: não alterado por esta auditoria.

## Reconciliação de branches

Antes da reconciliação, `origin/main` estava 27 commits e oito migrations à frente de
`origin/develop`, que não possuía commits exclusivos. A primeira leitura havia partido
da `develop` antiga; por isso ela foi considerada inválida como baseline final.

A correção foi executada isoladamente:

- branch: `agent/sync-main-into-develop`;
- PR: `#244` — `chore: sincronizar main de produção com develop`;
- checks: Verify, Migration staging e Vercel aprovados;
- atualização: fast-forward exato, sem commit artificial de merge;
- resultado: `origin/develop == origin/main == d8c0fd0`;
- divergência final: `0 / 0`.

A branch desta auditoria foi então rebaseada sobre a `develop` sincronizada e
todos os achados foram confrontados novamente.

| Referência | Último commit | Migration journal | Orchestrator |
|---|---|---:|---:|
| `origin/develop` | `d8c0fd0` — PR #243 | `0085_previous_iron_patriot` | 8.222 linhas |
| `origin/main` | `d8c0fd0` — PR #243 | `0085_previous_iron_patriot` | 8.222 linhas |

Consequência: não há mais uma “análise de produção em paralelo a uma base antiga”.
O parecer, os snapshots e o plano agora usam a mesma árvore que está em produção e
na integração.

## Pacote recebido

- Pasta lida: `/Users/brendonwalefy/Downloads/systemops-safe-v1-v2-handoff`
- 50 arquivos regulares verificados contra `SHA256SUMS.txt`
- ZIP original conferido contra o `.sha256`
- Segundo ZIP passou no teste de integridade e contém o mesmo payload, além de metadados `__MACOSX`
- `PROMPT-PARA-O-AGENT.md` é idêntico ao prompt mestre em `06-handoff-agent`

## Verificação do código

### Baseline sincronizada (`origin/main == origin/develop == d8c0fd0`)

Executado inicialmente no worktree temporário de produção e repetido na branch de
auditoria após o rebase:

```text
npm run db:check   OK
npm run lint       OK, 7 warnings preexistentes e 0 erros
npm run typecheck  OK
npm test           197 arquivos aprovados
                   1.960 testes aprovados
                   10 testes ignorados
                   1.970 testes no total
```

O pacote antigo registrava impossibilidade de typecheck; essa limitação não existe
na referência atual.

## Banco

- Acesso somente leitura usando a configuração local já existente.
- Clínicas amostradas: Ximendes, Clínica Vitalli e NC Beauty Clinic.
- Nenhuma seed, migration, `UPDATE`, `INSERT`, `DELETE` ou script `apply-*` foi executado.
- Snapshots exportados com credenciais, chaves Pix, telefones, e-mails, documentos e URLs redigidos.
- O exportador usa diretamente o schema sincronizado; não há mais desvio por SQL cru
  para campos que existiam apenas em produção.

## Sinal fora do escopo

`npm audit` reportou 15 vulnerabilidades na árvore completa (1 baixa, 4
moderadas, 8 altas e 2 críticas) e 7 na árvore de produção (1 baixa, 5 altas e 1
crítica). `npm run verify` não inclui `npm audit`. A triagem está em
`DEPENDENCY-SECURITY-SUMMARY.md` e deve seguir em PRs de segurança separados.
