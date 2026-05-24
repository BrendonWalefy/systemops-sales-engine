# Prompt: Owner Panel + Reestruturação de Rotas

## Contexto do projeto

Projeto: **systemops-core** — SaaS de recepcionista IA para clínicas odontológicas.
Stack: Next.js 15 App Router, Drizzle ORM, TypeScript, Postgres (Neon), deploy no Vercel.
Path alias: `@/` aponta para `src/`.

## Estado atual das rotas

```
/                          → landing pública (hero + demo flow)
/login                     → login único (sem separação de role)
/dashboard                 → área da clínica (sem prefixo)
/inbox                     → área da clínica (sem prefixo)
/inbox/[conversationId]    → conversa individual
/settings/playbook         → configurações da IA
```

Arquivos relevantes:
- `src/app/(admin)/` → route group atual com dashboard, inbox, settings
- `src/app/(admin)/layout.tsx` → layout com sidebar e auth guard
- `src/app/login/` → login atual
- `src/middleware.ts` → auth guard via session cookie
- `src/lib/session.ts` → gerenciamento de sessão

## Roles existentes no sistema

Hoje o sistema não tem campo `role` — qualquer usuário autenticado acessa tudo.
O login usa `ADMIN_EMAIL` e `ADMIN_PASSWORD` como env vars (hardcoded para piloto).

## O que precisa ser construído

### 1. Adicionar `role` na sessão

Arquivo: `src/lib/session.ts`

Adicionar campo `role: "owner" | "clinic_admin"` no payload da sessão.

Lógica de login:
- Se email === `OWNER_EMAIL` (env var) → role = `owner`, redireciona para `/owner`
- Qualquer outro admin autenticado → role = `clinic_admin`, redireciona para `/app/dashboard`

### 2. Reestruturar rotas (mover arquivos)

**De → Para:**
```
src/app/(admin)/dashboard/           → src/app/(clinic)/app/dashboard/
src/app/(admin)/inbox/               → src/app/(clinic)/app/inbox/
src/app/(admin)/settings/            → src/app/(clinic)/app/settings/
src/app/(admin)/layout.tsx           → src/app/(clinic)/layout.tsx
```

O route group `(clinic)` protege tudo sob `/app/*` exigindo role = `clinic_admin` ou `owner`.

**URLs resultantes:**
```
/app/dashboard
/app/inbox
/app/inbox/[conversationId]
/app/settings/playbook
```

### 3. Atualizar middleware

Arquivo: `src/middleware.ts`

Guards:
- `/app/*` → exige autenticação (qualquer role)
- `/owner/*` → exige role = `owner`
- `/login` → redireciona para `/owner` ou `/app/dashboard` se já autenticado

### 4. Criar página Owner Panel

#### `/owner` — Visão consolidada de todas as clínicas

Arquivo: `src/app/(owner)/owner/page.tsx`

Tabela com uma linha por clínica mostrando:
- Nome da clínica
- Leads atendidos no mês
- Taxa de conversão: leads com `status = appointment_scheduled` / total
- Custo IA + WhatsApp do mês (em USD, formatado como $0.0000)
- Último atendimento (timestamp relativo — "há 2h")
- Status da IA: badge verde "Ativa" ou vermelho "Pausada" (campo `autoReplyEnabled`)
- Alertas automáticos:
  - 🔴 IA pausada
  - 🟡 Sem atendimento há mais de 24h
  - 🟡 Taxa de conversão abaixo de 5%

Link de cada linha para `/owner/clinics/[clinicId]`.

#### `/owner/clinics/[clinicId]` — Drill-down de uma clínica

Arquivo: `src/app/(owner)/owner/clinics/[clinicId]/page.tsx`

Seções:
1. **Header**: nome da clínica, status IA, botão para acessar inbox da clínica
2. **KPIs do mês**: leads, agendamentos, conversão, custo IA, custo WhatsApp
3. **Volume diário** (últimos 30 dias): tabela simples com data + nº de leads + nº de mensagens
4. **Últimas conversas com handoff**: lista das conversas onde `handoffRequired = true`
5. **Amostra de mensagens que a IA não soube responder**: conversas onde após resposta da IA o lead ficou sem retorno por mais de 1h (proxy de falha)

#### Layout do Owner

Arquivo: `src/app/(owner)/layout.tsx`

Sidebar simples com:
- Logo / "SystemOps Owner"
- Link: Visão geral (`/owner`)
- Link: Clínicas (`/owner/clinics`) — se quiser listar separado
- Separador
- Logout

Design: seguir o mesmo design system (`src/app/globals.css`) — dark mode premium, mesma paleta.

### 5. Adicionar env var `OWNER_EMAIL`

O `OWNER_EMAIL` (seu e-mail pessoal) determina quem recebe role `owner` ao fazer login.
Deve ser adicionado como env var no Vercel e no `.env.local`.

Não requer mudança de schema — é só lógica de auth no login.

## Restrições

- NÃO quebrar o webhook Z-API em `src/app/api/whatsapp/zapi/route.ts` (não muda)
- NÃO quebrar o webhook Meta em `src/app/api/whatsapp/webhook/route.ts` (não muda)
- NÃO mudar a landing page (`src/app/page.tsx` e `src/app/demo-flow.tsx`)
- Manter o design system existente (`src/app/globals.css`)
- `npx tsc --noEmit` deve passar sem erros antes do commit
- Commitar e dar push ao final

## Critério de sucesso

1. `brendonwalefyom@gmail.com` faz login → vai para `/owner` com visão de todas as clínicas
2. Login de clínica → vai para `/app/dashboard` (comportamento atual preservado)
3. Tentativa de acessar `/owner` com role `clinic_admin` → redirect para `/app/dashboard`
4. Página `/owner` mostra métricas consolidadas com alertas operacionais
5. Página `/owner/clinics/[clinicId]` mostra drill-down da clínica
6. Todas as rotas antigas (`/dashboard`, `/inbox`) redirecionam para as novas (`/app/dashboard`, `/app/inbox`)
