# Migrations

O histórico reprodutível começa em `drizzle/0000_baseline.sql`; mudanças posteriores são migrations incrementais geradas pelo Drizzle.

## Fluxo normal

```bash
# 1. altere src/infrastructure/db/schema.ts
npm run db:generate

# 2. revise o SQL e os metadados gerados
npm run db:check

# 3. aplique em ambiente local/isolado
npm run db:migrate

# 4. valide o projeto
npm run verify
```

Não use `drizzle-kit push` em produção e não edite migration gerada manualmente, exceto para corrigir uma migration quebrada que ainda não foi aplicada em nenhum ambiente.

## CI de schema

PRs que alteram `drizzle/*.sql` ou `src/infrastructure/db/schema.ts` ativam `.github/workflows/migration-ci.yml`:

1. cria branch Neon descartável a partir do banco configurado;
2. aplica as migrations;
3. executa `npm run verify`;
4. remove a branch mesmo em falha.

Configuração em [staging-ci-setup.md](staging-ci-setup.md).

## Checklist do PR

- schema e migration estão no mesmo PR;
- SQL foi revisado quanto a lock, backfill, nullability e índices;
- código suporta a ordem real de deploy;
- migration foi testada no branch Neon;
- rollback está descrito;
- novas FKs para organizações, conversas ou leads passaram pelo check de purge;

```bash
npx dotenv -e .env.local -- npx tsx scripts/check-purge-coverage.ts
```

## Deploy e rollback

Para mudanças aditivas, implante em ordem compatível: schema primeiro, código que escreve depois e remoção somente em uma entrega futura. Para mudanças destrutivas, use expand/contract.

Antes da produção, registre:

- backup/branch de recuperação;
- comando exato;
- duração esperada e risco de lock;
- critério de sucesso;
- rollback ou estratégia de roll-forward.
