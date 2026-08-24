# DEVELOPER — Guia rápido para desenvolvedores

Propósito: permitir que um novo desenvolvedor configure, rode e depure o projeto localmente de forma rápida e confiável.

Pré-requisitos
- Node.js 22+ e npm
- PostgreSQL acessível (local ou Neon) — `DATABASE_URL` configurada
- VS Code recomendado para debug (opcional)

Passo a passo rápido

1) Clone e branch

```bash
git clone git@github.com:BrendonWalefy/systemops-sales-engine.git
cd systemops-sales-engine
git checkout develop   # develop é a branch de integração; main é produção
```

2) Setup automático (recomendado)

```bash
# instala deps, cria .env.local (se necessário), aplica migrations e inicia dev
./scripts/dev-setup.sh --workers
# ou usar o Makefile
make setup
```

3) Manual (se preferir etapas separadas)

```bash
npm install
cp .env.example .env.local   # edite .env.local (mínimo: DATABASE_URL)
npm run db:migrate
npm run dev
```

Variáveis de ambiente
- Mínimo: `DATABASE_URL` (aponta para seu Postgres de desenvolvimento)
- Consulte `.env.example` para outras variáveis usadas em IA, e-mail e storage (ex.: chaves OpenAI/Anthropic/Resend). Não commite segredos.

Workers e processamento assíncrono
- Workers processam filas (`inbound_events`, `jobs`, `outbound_messages`). Para rodá-los localmente:

```bash
npm run dev:workers
```

Debug e VS Code
- Há uma configuração pronta em `.vscode/launch.json`:
  - `Next: Dev (with inspector)` inicia os workers (preLaunchTask) e liga o inspector em `9229`.
  - Use `Attach to Node (9229)` para anexar manualmente.
- Alternativa em terminal:

```bash
npm run dev:inspect
# ou
NODE_OPTIONS='--inspect=9229' npm run dev
```

Testes e verificação
- Checagem completa (lint, typecheck, testes):

```bash
npm run verify
```

- Suíte focada em agenda:

```bash
npm run verify:agenda
```

- Teste específico que usa `.env.test.local`:

```bash
npm run test:db
```

Contribuição e boas práticas
- Branches: `feat/<area>-<change>`, `fix/<area>-<bug>`, `chore/<area>-<task>`
- Sempre rode `npm run verify` antes de criar PR.
- Pequenos commits focados e tests para alterações que tocam regras de negócio, agenda, webhooks ou migrações.

Resolução rápida de problemas
- Erro de conexão com DB: verifique `DATABASE_URL` e se o DB aceita conexões locais.
- Migrations falhando: confirme que `drizzle` está instalado e que `drizzle.config.ts` está correto; rodar `npm run db:generate` só quando estiver alterando schema.
- Erro de chave/API: veja `.env.local` e variáveis necessárias no `.env.example`.

Links úteis
- Leia `README.md` para visão geral e arquitetura.
- Regras de contribuição e deploy: `AGENTS.md`.
