# Staging CI para migrations

O workflow `.github/workflows/migration-ci.yml` valida toda alteração de schema em uma branch Neon descartável antes do merge.

## Secrets necessários

| Secret | Origem |
| --- | --- |
| `NEON_PROJECT_ID` | Neon Project Settings |
| `NEON_API_KEY` | Neon Account Settings |
| `NEON_DB_USER` | Neon Connection Details |

## Proteção de branch

Em `develop` e `main`, exija o check **Test migration on staging branch** para PRs que alterem schema/migrations. `develop` recebe integração; `main` recebe apenas promoção validada ou hotfix aprovado.

## Operação

- O branch Neon é temporário e deve ser removido mesmo quando a migration falha.
- Dados do branch não podem ser exportados para logs ou artefatos públicos.
- Falha no workflow bloqueia o merge; não contorne o check.
- A branch de CI valida schema, mas não substitui QA do comportamento afetado.

Referências: [Neon branching with GitHub Actions](https://neon.com/docs/guides/branching-github-actions) e [Migrations](migrations-baseline.md).
