# Staging CI — Setup e Operação

**Status:** Implementado — requer configuração de secrets e branch protection  
**Criado em:** 2026-06-30  
**Workflow:** `.github/workflows/migration-ci.yml`

---

## O que o workflow faz

Em todo PR que toca `drizzle/*.sql` ou `src/infrastructure/db/schema.ts`:

1. Cria branch Neon a partir do snapshot de produção
2. Aplica a migration SQL no banco de staging
3. Roda `npm run verify` (lint + typecheck + vitest) contra o banco de staging
4. Destroi a branch Neon — mesmo se o job falhar (`if: always()`)

PRs sem toque em schema não ativam o workflow (não há custo nem delay).

---

## Secrets necessários no GitHub

Adicionar em **Settings → Secrets and variables → Actions**:

| Secret | Como obter |
|--------|------------|
| `NEON_PROJECT_ID` | Neon dashboard → Project Settings → General → Project ID |
| `NEON_API_KEY` | Neon dashboard → Account Settings → API Keys → Generate new key |
| `NEON_DB_USER` | Neon dashboard → Connection Details → User (geralmente `neondb_owner`) |

O `DATABASE_URL` já existe como secret (usado pelo workflow `run-migration.yml`) e não precisa ser alterado.

---

## Branch protection (obrigatório para o status check bloquear merge)

1. GitHub → Settings → Branches → Add rule para `main`
2. Em **Require status checks to pass before merging**, adicionar:
   - `Test migration on staging branch`
3. Marcar **Require branches to be up to date before merging**

Sem essa configuração, o workflow roda mas não bloqueia o merge.

---

## Validação após configurar

Para confirmar que está funcionando:

1. Criar um PR que toca qualquer arquivo em `drizzle/` (pode ser um arquivo de teste)
2. Verificar que o workflow `Migration CI` aparece nos checks do PR
3. Confirmar que o branch Neon é criado e destruído no Neon dashboard

---

## Referências

- `docs/operations/backlog-staging-ci-migrations.md` — contexto e motivação
- `docs/architecture/adr/adr-001-clinic-to-organization-rename.md` — caso de uso que desbloqueou esta demanda
- Neon Branching Actions: https://neon.tech/docs/guides/branching-github-actions
