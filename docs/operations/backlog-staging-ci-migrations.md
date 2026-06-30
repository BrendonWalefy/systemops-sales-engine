# Backlog: Staging com CI Testando Migrations Antes de Prod

**Status:** ✅ IMPLEMENTADO — workflow em `.github/workflows/migration-ci.yml`  
**Prioridade:** Alta (pré-requisito para ADR-001 Camada 2 e para qualquer migration de schema destrutiva futura)  
**Criado em:** 2026-06-30  
**Setup:** ver `docs/operations/staging-ci-setup.md` para configurar secrets e branch protection

---

## Por que isso é necessário

Hoje o fluxo de migration em produção é:

```
developer escreve migration → push para develop → deploy Vercel → migration aplicada em prod
```

Não existe validação intermediária. Qualquer erro na migration SQL vai direto para o banco de produção da Ximendes.

Isso foi aceitável enquanto o produto estava em piloto com um único cliente. Com múltiplos tenants, qualquer migration mal escrita pode derrubar todos simultaneamente.

O pré-requisito mais urgente é o **ADR-001 Camada 2** (renomear `clinics` → `organizations` no banco), que envolve 48 FKs e não pode ser executada sem staging.

---

## O que precisa ser construído

### 1. Ambiente de staging

Um ambiente separado de produção com:
- Banco Neon dedicado (branch de staging — o Neon já suporta branches de banco nativamente)
- Deploy Vercel separado apontando para o banco de staging
- Dados espelhados ou sintéticos da Ximendes para testar comportamento real

**Neon Branch:** o Neon permite criar um branch do banco de prod em segundos, com snapshot dos dados. Isso elimina a necessidade de manter dados sintéticos manualmente.

### 2. CI que testa migrations antes do merge

Pipeline sugerido (GitHub Actions):

```
PR aberto →
  1. Criar branch Neon do banco de prod (snapshot)
  2. Aplicar migration SQL no branch de staging
  3. Rodar suite de testes (vitest) contra banco de staging
  4. Se tudo passar → PR pode ser mergeado
  5. Ao mergear → aplicar migration em prod
  6. Destruir branch Neon de staging após o merge
```

### 3. Checklist de migration segura

Para cada migration que toca schema (não apenas dados), o CI deve validar:

- [ ] Migration é reversível (existe rollback ou é additive-only)?
- [ ] Migration não bloqueia tabela por mais de X segundos (lock timeout)?
- [ ] Testes unitários passam após a migration?
- [ ] Drizzle schema TypeScript bate com o banco após a migration?

---

## Esforço estimado

| Componente | Esforço |
|---|---|
| Branch Neon de staging configurado | 1-2h |
| Deploy Vercel de staging apontando pro Neon branch | 1-2h |
| GitHub Actions workflow com Neon branch + vitest | 4-6h |
| Documentação do processo para o time | 1h |
| **Total** | **~1 dia** |

---

## Sequência recomendada

```
Etapa 1 — Neon branch de staging
  → Criar branch "staging" no Neon a partir do snapshot de prod
  → Configurar DATABASE_URL_STAGING nas secrets do GitHub

Etapa 2 — Vercel staging
  → Criar preview deployment fixo (não por PR, mas por branch develop)
  → Apontar para DATABASE_URL_STAGING
  → Validar que a aplicação sobe com o banco de staging

Etapa 3 — GitHub Actions
  → Trigger: PR que toca arquivos em drizzle/*.sql ou src/infrastructure/db/schema.ts
  → Steps: neon branch create → drizzle migrate → vitest → neon branch delete
  → Status check obrigatório antes de merge

Etapa 4 — Validação
  → Rodar ADR-001 Camada 1 (rename TypeScript) como PR de teste
  → Garantir que o CI passa sem tocar no banco
  → Depois executar ADR-001 Camada 2 como o primeiro PR real com migration testada
```

---

## Referências

- `docs/architecture/adr/adr-001-clinic-to-organization-rename.md` — caso de uso que desbloqueou esta demanda
- `docs/operations/migrations-baseline.md` — estado atual das migrations
- Neon Branching: https://neon.tech/docs/guides/branching-github-actions
- Vercel Preview Deployments: configurável via `vercel.json`
