# SystemOps Core

Aplicação principal da SystemOps — SaaS de recepcionista IA para clínicas odontológicas.

**Produção:** https://systemops-core-brendon-walefy-s-projects.vercel.app

---

## Tese

Clínicas não precisam apenas de mais leads. Elas precisam operar melhor os leads que já recebem.

A SystemOps organiza a jornada comercial:
1. lead entra pelo WhatsApp;
2. sistema registra origem, conversa e status;
3. agente especialista em vendas analisa o contexto;
4. recepção aprova ou edita a recomendação;
5. Google Calendar ajuda a encontrar/agendar horário;
6. follow-up e resultado voltam para o core;
7. gestor enxerga conversão, perdas e ROI.

---

## Rotas e Telas

### Públicas
| Rota | Descrição |
|------|-----------|
| `/` | Landing page com hero e demo flow |
| `/login` | Login único — redireciona por role após autenticação |

### Clinic Admin (`/app/*`)
Requer autenticação com role `clinic_admin` ou `owner`.

| Rota | Tela | URL produção |
|------|------|--------------|
| `/app/dashboard` | Dashboard com KPIs (leads, agendamentos, custos, temperatura) | [abrir](https://systemops-core-brendon-walefy-s-projects.vercel.app/app/dashboard) |
| `/app/inbox` | Inbox — lista de conversas ativas | [abrir](https://systemops-core-brendon-walefy-s-projects.vercel.app/app/inbox) |
| `/app/inbox/[id]` | Conversa individual com chat + painel do lead | — |
| `/app/settings/playbook` | Configurações da IA (tom de voz, playbook, horários) | [abrir](https://systemops-core-brendon-walefy-s-projects.vercel.app/app/settings/playbook) |

### Owner Panel (`/owner/*`)
Requer autenticação com role `owner`. Acesso exclusivo via `OWNER_EMAIL`.

| Rota | Tela | URL produção |
|------|------|--------------|
| `/owner` | Visão consolidada de todas as clínicas (KPIs + alertas) | [abrir](https://systemops-core-brendon-walefy-s-projects.vercel.app/owner) |
| `/owner/clinics/[id]` | Drill-down de uma clínica (volume diário, handoffs, falhas da IA) | — |

### Rotas legadas (redirecionam automaticamente)
| De | Para |
|----|------|
| `/dashboard` | `/app/dashboard` |
| `/inbox` | `/app/inbox` |
| `/inbox/[id]` | `/app/inbox/[id]` |
| `/settings/playbook` | `/app/settings/playbook` |

---

## Roles e Autenticação

O sistema usa tokens HMAC-SHA256 com role embutida no payload.

| Role | Acesso | Como configurar |
|------|--------|-----------------|
| `owner` | `/owner/*` + tudo em `/app/*` | Definir `OWNER_EMAIL` |
| `clinic_admin` | `/app/*` | Adicionar email em `ADMIN_EMAIL` |

**Fluxo de login:**
- `OWNER_EMAIL` + `OWNER_PASSWORD` (ou `ADMIN_PASSWORD`) → role `owner` → `/owner`
- Qualquer email em `ADMIN_EMAIL` + `ADMIN_PASSWORD` → role `clinic_admin` → `/app/dashboard`

---

## Variáveis de Ambiente

Copie `.env.example` para `.env.local` e preencha:

```bash
# Auth
OWNER_EMAIL="brendonwalefyom@gmail.com"     # acesso ao /owner panel
OWNER_PASSWORD=""                            # opcional — usa ADMIN_PASSWORD se vazio
ADMIN_EMAIL="adm@clinica.com,gregorie@clinica.com"  # múltiplos, separados por vírgula
ADMIN_PASSWORD="senha-compartilhada"

SESSION_SECRET="string-aleatoria-longa"

# Banco
DATABASE_URL="postgres://..."

# Google Calendar (service account)
GOOGLE_CALENDAR_ID=""
GOOGLE_SERVICE_ACCOUNT_EMAIL=""
GOOGLE_PRIVATE_KEY=""

# WhatsApp
WHATSAPP_VERIFY_TOKEN=""
WHATSAPP_ACCESS_TOKEN=""
WHATSAPP_PHONE_NUMBER_ID=""
RECEPTIONIST_PHONE_NUMBER=""

# OpenAI
OPENAI_API_KEY=""

# Piloto
PILOT_CLINIC_ID=""
```

### Adicionar usuário Gregorie (clinic admin)
Edite `ADMIN_EMAIL` no Vercel adicionando o email dele separado por vírgula:
```
ADMIN_EMAIL=adm@clinica.com,gregorie@clinica.com
```
Ele usará a mesma `ADMIN_PASSWORD` já configurada.

---

## Stack

- **Framework:** Next.js 15 (App Router)
- **Banco:** PostgreSQL (Neon) via Drizzle ORM
- **Auth:** Custom HMAC-SHA256 (sem dependência externa)
- **Deploy:** Vercel
- **AI:** OpenAI API
- **WhatsApp:** Z-API / Meta Cloud API
- **Calendário:** Google Calendar (service account)

## Estrutura de Rotas (App Router)

```
src/app/
├── page.tsx                     # Landing
├── login/                       # Login + actions
├── (admin)/                     # Rotas legadas com redirects
├── (clinic)/app/                # Área da clínica (dashboard, inbox, settings)
└── (owner)/owner/               # Owner panel (visão consolidada)
```

## Instalação no Celular (PWA)

O SystemOps é instalável como app na tela inicial — sem App Store ou Play Store.
Abre em tela cheia, sem barra do navegador, com ícone próprio.

### Android — Google Chrome

1. Acesse o sistema pelo Chrome
2. Toque nos **3 pontinhos** → **"Adicionar à tela inicial"**
3. Confirme o nome e toque em **Adicionar**

> Em alguns dispositivos o Chrome exibe um banner automático de instalação na parte inferior da tela.

### iPhone — Safari

> Obrigatório usar o Safari. Chrome e outros navegadores no iPhone não permitem instalação.

1. Acesse o sistema pelo **Safari**
2. Toque no ícone de **Compartilhar** (seta para cima na barra inferior)
3. Role e toque em **"Adicionar à Tela de Início"**
4. Confirme e toque em **Adicionar**

### O que esperar após instalar

- App abre em **tela cheia** (sem barra do navegador)
- Ícone com fundo escuro e raio verde na tela inicial
- Abre direto no Inbox de conversas

### Arquivos relevantes

| Arquivo | Descrição |
|---------|-----------|
| `src/app/manifest.ts` | Manifest PWA (nome, cores, start_url, ícones) |
| `src/app/layout.tsx` | Meta tags apple-web-app e viewport |
| `public/icons/` | Ícones PNG: 192×192, 512×512, 180×180 (iOS) |

---

## Webhooks (não alterar)

- `POST /api/whatsapp/webhook` — Meta Cloud API
- `POST /api/whatsapp/zapi` — Z-API incoming messages
- `GET  /api/clinic/auto-reply` — toggle auto-reply

---

## Tese
Clínicas não precisam de mais leads. Precisam operar melhor os que já chegam.
