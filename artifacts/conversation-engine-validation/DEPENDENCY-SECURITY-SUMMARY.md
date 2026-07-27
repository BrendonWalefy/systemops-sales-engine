# Resumo de segurança de dependências

Data da remediação: 26/07/2026
Branch: `fix/dependency-security`

## Resultado

Depois das atualizações e overrides verificados, `npm audit --omit=dev --json`
não encontra vulnerabilidades na árvore de produção:

| Severidade | Quantidade de pacotes reportados |
|---|---:|
| Crítica | 0 |
| Alta | 0 |
| Moderada | 0 |
| Baixa | 0 |
| Total | 0 |

O audit completo ainda reporta 13 itens apenas na cadeia de desenvolvimento:
9 altos na árvore do ESLint/minimatch e 4 moderados em
`drizzle-kit@0.31.10 -> @esbuild-kit/esm-loader -> esbuild@0.18.20`. Eles não
entram no bundle/runtime de produção. O `npm audit fix --force` foi recusado
porque propõe downgrade do Drizzle Kit para `0.18.1` e upgrades major de lint,
ambos mais arriscados que a exposição local restante.

## Prioridade

### SEC-01 — Next.js e transitivas de runtime — resolvido

- `next` e `eslint-config-next` atualizados para `16.2.12`;
- `postcss` fixado em `8.5.23` e `sharp` em `0.35.3` por override;
- build, lint, typecheck, migrations e suíte completa são gates obrigatórios.

### SEC-02 — `@auth/core` direto e não utilizado — resolvido

- removido de `package.json` e lockfile;
- não havia import em código; autenticação atual continua em `src/lib/session`.

### SEC-03 — Tooling de teste — resolvido

- `vitest` atualizado para `3.2.7` e `vite` resolvido em `7.3.6`.

### SEC-04 — Risco residual de desenvolvimento — aceito temporariamente

- quatro advisories moderados permanecem na cadeia antiga embutida no
  `drizzle-kit`; ela é CLI local e não abre servidor de desenvolvimento;
- advisories de glob/minimatch pertencem ao lint local. Forçar uma versão major
  de `brace-expansion` quebrou o ESLint em validação e foi revertido;
- revisar quando Drizzle Kit/ESLint publicarem uma cadeia compatível corrigida.

## Guardrails

- Não executar `npm audit fix --force` automaticamente.
- O próprio audit sugere, em uma cadeia de tooling, uma versão antiga de
  `drizzle-kit`; aceitar isso cegamente pode causar downgrade e incompatibilidade.
- Manter overrides somente enquanto as dependências diretas ainda não carregam
  as versões corrigidas.
- Reexecutar `npm audit --omit=dev`, `npm run verify`, `npm run build` e smoke de
  autenticação/deploy preview antes de promover.

## Veredito

A árvore de produção está limpa no audit atual. O risco residual está isolado em
ferramentas locais e não justifica downgrades automáticos ou overrides que
quebrem os gates do repositório.
