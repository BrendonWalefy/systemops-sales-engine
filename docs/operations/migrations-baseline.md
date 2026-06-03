# Baseline de migrations (squash) — histórico limpo e reprodutível

## O que mudou e por quê

Antes, o histórico de migrations não reconstruía um banco do zero: nenhuma
migration registrada no journal criava `clinic_members`, as colunas de canal
da `clinics`, `slug` ou `notes` — esses objetos só existiam em produção porque
foram aplicados à mão. Um `drizzle-kit migrate` numa base nova quebrava.

Agora há **um único baseline** (`drizzle/0000_baseline.sql`) gerado a partir do
`schema.ts` atual, que cria o schema inteiro. Validação: `drizzle-kit generate`
reporta "No schema changes" — ou seja, o baseline é fiel ao schema, sem drift.

As 31 migrations antigas foram removidas do diretório de trabalho, mas seguem
no histórico git (na branch anterior) caso você precise consultá-las.

## Como a produção fica protegida (leia antes de aplicar)

O baseline tem dois mecanismos de segurança somados:

1. **`when: 1` no journal.** O `drizzle-kit migrate` só aplica migrations com
   timestamp maior que o último já registrado no banco. Sua produção já tem
   migrations registradas com timestamps grandes, então o baseline (timestamp 1)
   é considerado "antigo" e **ignorado** — nenhum DDL roda na prod.
2. **Idempotência.** Mesmo que, por algum motivo, o baseline rode, todos os
   statements usam `CREATE TABLE IF NOT EXISTS`, `CREATE TYPE` em bloco `DO`
   que ignora duplicados, índices `IF NOT EXISTS` e constraints em `DO` que
   ignoram duplicados. Em um banco que já tem tudo, é um no-op.

Em um banco NOVO (tabela de migrations vazia), o baseline é aplicado e constrói
o schema completo. É isso que conserta a reprodutibilidade.

## Procedimento de adoção (com rede de segurança)

**Passo 1 — Teste num branch descartável do Neon (NÃO pule).**
O Neon permite criar um branch do banco de produção em segundos. Crie um branch,
aponte `DATABASE_URL` para ele e rode:

```bash
DATABASE_URL="<url-do-branch-neon>" npm run db:migrate
```

Esperado: o drizzle reporta que não há nada a aplicar (a prod-cópia já tem tudo,
e o baseline é ignorado pelo `when`). Confirme que nenhum erro aparece e que os
dados continuam intactos. Descarte o branch depois.

**Passo 2 — Teste o build do zero (reprodutibilidade).**
Crie um banco Neon vazio, aponte `DATABASE_URL` para ele e rode `npm run db:migrate`.
Esperado: o baseline roda e cria as 18 tabelas. Confirme com `\dt` ou similar.

**Passo 3 — Produção.**
Faça um backup/branch de segurança do banco de produção. Depois rode
`npm run db:migrate` apontando para produção. Esperado: nada a aplicar (no-op).

## Daqui pra frente

Mudanças de schema seguem o fluxo normal: edite `schema.ts`, rode
`npm run db:generate` (cria `0001_...`), revise o SQL, `npm run db:migrate`.
O baseline passa a ser o ponto de partida do histórico.

## Verificação rápida

- `npm run db:generate` deve dizer "No schema changes" enquanto o `schema.ts`
  não mudar — se disser que há mudanças, o baseline e o schema divergiram.
- SHA256 do baseline desta entrega:
  `9fae07376c19cd1cb0b8e40acaf4feb1bf0c7d72ede66d237358f60fc2cf2ec3`
