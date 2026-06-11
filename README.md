# SystemOps Core

Aplicacao principal da SystemOps: recepcionista comercial com IA para clinicas, com WhatsApp, agenda, inbox, onboarding de clinicas e painel de owner.

Producao: https://systemops-core.vercel.app

## Estado Atual

- Multi-clinica: configuracao operacional vive no banco, por clinica.
- WhatsApp atual: Z-API por clinica, resolvida por `zapiInstanceId`.
- Agenda atual: `clinics.calendarMode` define a fonte de verdade. No modo `internal`, slots, agendamentos e bloqueios vivem no banco; no modo `google_calendar`, Google Calendar segue como opt-in legado.
- Login de clinica: usuarios em `clinic_members.password_hash`.
- Login owner: `OWNER_EMAIL` e `OWNER_PASSWORD` via env.
- Migrations: baseline unico em `drizzle/0000_baseline.sql`, reprodutivel do zero.
- Producao: Vercel + Neon + Drizzle migrate.

## Rotas Principais

### Publicas

| Rota | Uso |
| --- | --- |
| `/` | Landing/demo inicial |
| `/login` | Login unico com redirecionamento por role |

### Area da Clinica

| Rota | Uso |
| --- | --- |
| `/app/dashboard` | KPIs da clinica |
| `/app/inbox` | Conversas ativas, atencao humana e historico |
| `/app/inbox/[conversationId]` | Chat, pausa da IA e agendamento manual |
| `/app/agenda` | Agenda e bloqueios |
| `/app/settings/playbook` | Configuracao da IA, playbook, simulador e sugestoes |
| `/app/settings/tratamentos` | Tratamentos/procedimentos |
| `/app/settings/profissionais` | Profissionais e agenda por recurso |

### Owner

| Rota | Uso |
| --- | --- |
| `/owner` | Visao consolidada das clinicas |
| `/owner/clinics/new` | Onboarding manual de clinica |
| `/owner/clinics/[clinicId]` | Detalhe, saude operacional e reset de dados |
| `/owner/financeiro` | Custos e indicadores financeiros |

### APIs Operacionais

| Rota | Uso |
| --- | --- |
| `POST /api/whatsapp/zapi` | Webhook Z-API atual |
| `POST /api/conversations/[conversationId]/send` | Envio manual pelo inbox |
| `POST /api/calendar/setup-watch` | Setup de watch do Google Calendar para clinicas em modo opt-in |
| `/api/cron/*` | Rotinas protegidas por `CRON_SECRET` |
| `/api/e2e/*` | Rotas destrutivas de teste, so com `E2E_MODE=true` fora de producao |

O endpoint `POST /api/whatsapp/webhook` para Meta Cloud API ainda existe como compatibilidade, mas nao e o fluxo de producao atual.

## Arquitetura em Uma Frase

O LLM entende e verbaliza; o sistema decide.

O fluxo central fica em `ConversationOrchestrator`: ele recebe a mensagem normalizada, consulta estado, classifica intencao, executa regra deterministica, agenda quando necessario e so entao pede ao `ResponseComposer` para escrever a resposta.

Leia a arquitetura atual em [docs/architecture/current.md](docs/architecture/current.md).

## Variaveis de Ambiente

Use `.env.example` como contrato minimo. Nao coloque credenciais de clinica em env.

| Variavel | Uso |
| --- | --- |
| `DATABASE_URL` | PostgreSQL/Neon |
| `SESSION_SECRET` | Assinatura das sessoes |
| `OWNER_EMAIL` | Login do owner |
| `OWNER_PASSWORD` | Senha do owner |
| `OPENAI_API_KEY` | Classificacao, composicao e transcricao |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account do Google Calendar, usada apenas no modo `google_calendar` |
| `GOOGLE_PRIVATE_KEY` | Chave privada da service account, usada apenas no modo `google_calendar` |
| `CRON_SECRET` | Protecao das rotas cron |
| `TOGGLE_SECRET` | Protecao de toggles operacionais |
| `SIMULATE_API_KEY` | Acesso ao sandbox de simulacao |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Push notifications no browser |
| `VAPID_PRIVATE_KEY` | Push notifications no servidor |
| `VAPID_SUBJECT` | Identidade VAPID |

Configuracoes por clinica ficam no banco: Z-API, `calendarMode`, Google Calendar opcional, playbook, tom de voz, horarios, timezone, profissionais e tratamentos.

## Setup Local

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Scripts uteis:

```bash
npm run verify          # lint + typecheck + testes
npm run verify:agenda   # testes focados em agenda/calendario
npm run db:generate     # gera migration a partir do schema
npm run db:migrate      # aplica migrations usando .env.local
npm run create-clinic   # cria clinica via script de onboarding
npm run seed            # seed local da Ximendes
```

## Banco e Migrations

O historico antigo foi consolidado em um baseline:

- `drizzle/0000_baseline.sql`
- `drizzle/meta/0000_snapshot.json`
- `drizzle/meta/_journal.json`

Para detalhes e procedimento seguro, leia [docs/operations/migrations-baseline.md](docs/operations/migrations-baseline.md).

## Documentacao

Comece por [docs/README.md](docs/README.md).

Documentos mais usados:

- [Arquitetura atual](docs/architecture/current.md)
- [Change control e deploy safety](docs/operations/change-control.md)
- [Onboarding de clinica](docs/operations/onboarding-clinica.md)
- [Posicionamento do produto](docs/product/positioning.md)
- [Guia de UX para agentes](docs/agent-guides/saas-ux-strategy.md)

## Regras de Trabalho

`main` e producao. Para mudancas normais:

1. criar branch focada;
2. manter escopo pequeno;
3. rodar `npm run verify`;
4. abrir PR ou validar preview;
5. mergear somente com checks verdes.

As regras completas ficam em [AGENTS.md](AGENTS.md).
