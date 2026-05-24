# SystemOps — Roadmap de Produto

> Documento de referência para execução com o agente.
> Cada fase tem um objetivo claro, o que construir e o prompt sugerido para o agente.

---

## Estado atual

- Demo interativa em produção: https://systemops-core.vercel.app
- Landing em produção: https://systemops.vercel.app
- IA determinística (sem custo de LLM) respondendo leads
- After-hours mode, ROI calculator, clinic name, lead temperature score
- Sem persistência de dados, sem WhatsApp real, sem admin

---

## Fase 1 — Piloto operacional

**Objetivo:** conectar o WhatsApp real da clínica do amigo e ter a IA respondendo leads de verdade.

**Critério de sucesso:** 1 lead atendido pela IA fora do horário, com handoff para recepcionista no dia seguinte.

### 1.1 Integração WhatsApp Business API

**O que construir:**
- Endpoint `/api/whatsapp/webhook` para receber mensagens via Meta Cloud API
- Verificação do token `WHATSAPP_VERIFY_TOKEN` (GET) e processamento de mensagens (POST)
- Envio de resposta via API do WhatsApp (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`)
- Conectar ao `autonomous-receptionist` existente

**Env vars necessárias:**
```
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
```

**Prompt para o agente:**
```
Preciso criar a integração com WhatsApp Business Cloud API no systemops-core.

Criar em src/app/api/whatsapp/webhook/route.ts:
- GET: verificar token WHATSAPP_VERIFY_TOKEN e retornar hub.challenge
- POST: receber mensagem de texto de um lead, chamar decideAutonomousReceptionistReply
  do autonomous-receptionist com contexto da clínica, e enviar resposta via
  fetch para https://graph.facebook.com/v20.0/{PHONE_NUMBER_ID}/messages

A clínica padrão para o piloto deve vir de variável de ambiente PILOT_CLINIC_NAME.
Persistir a conversa no banco usando Drizzle (tabelas já existem em schema.ts).
```

---

### 1.2 Persistência de conversas

**O que construir:**
- Salvar cada mensagem recebida e enviada na tabela `conversations` e `messages`
- Criar lead automaticamente se não existir (por número de telefone)
- Atualizar status do lead conforme decisão da IA

**Prompt para o agente:**
```
Preciso salvar conversas do WhatsApp no banco de dados do systemops-core.

Usando Drizzle ORM e o schema em src/infrastructure/db/schema.ts:
1. Verificar se já existe lead pelo número de telefone, criar se não existir
2. Criar ou recuperar a conversation ativa desse lead
3. Salvar a mensagem do lead e a resposta da IA
4. Atualizar o status do lead conforme a ReceptionistDecision (handoff_required, appointment_scheduled, etc.)

O DATABASE_URL já está configurado como env var.
```

---

### 1.3 Notificação de handoff para recepcionista

**O que construir:**
- Quando `handoffRequired: true`, enviar mensagem WhatsApp para número da recepcionista
- Mensagem deve conter: nome do lead, número, resumo da conversa, motivo do handoff

**Prompt para o agente:**
```
Quando a IA decidir handoff (handoffRequired: true), preciso notificar a recepcionista.

No webhook do WhatsApp, após processar a mensagem:
- Se decision.handoffRequired === true, enviar mensagem via WhatsApp API
  para RECEPTIONIST_PHONE_NUMBER com: nome do lead, telefone, última mensagem,
  motivo do handoff e link direto para a conversa no admin.

Env vars: RECEPTIONIST_PHONE_NUMBER
```

---

## Fase 2 — Admin mínimo

**Objetivo:** a recepcionista consegue ver todas as conversas, status dos leads e histórico completo sem precisar do WhatsApp.

**Critério de sucesso:** recepcionista abre o admin no celular e consegue responder um lead em menos de 2 minutos.

### 2.1 Tela de conversas (Inbox)

**O que construir:**
- Rota `/inbox` com lista de conversas ativas
- Status visual: novo, em atendimento, agendado, handoff, frio
- Filtro por status
- Score de temperatura do lead

**Prompt para o agente:**
```
Criar a tela de Inbox em src/app/inbox/page.tsx no systemops-core.

Deve listar todas as conversas do banco ordenadas por última mensagem.
Cada item da lista mostra: avatar inicial do nome, nome do lead, telefone,
última mensagem (truncada), timestamp, status pill colorido e temperatura.

Usar os tokens de cor do globals.css existente. Sem libs externas.
Buscar dados via Server Component com Drizzle.
```

---

### 2.2 Tela de conversa individual

**O que construir:**
- Rota `/inbox/[conversationId]` com histórico completo
- Painel lateral com dados do lead (CRM mínimo)
- Botão "Assumir atendimento" que muda status para handoff humano
- Campo para responder pelo admin (envia via WhatsApp API)

**Prompt para o agente:**
```
Criar a tela de conversa individual em src/app/inbox/[conversationId]/page.tsx.

Layout 2 colunas: chat completo à esquerda, painel do lead à direita.
Chat mostra mensagens com autor (lead vs IA), timestamp e status de leitura.
Painel do lead: nome, telefone, canal, temperatura, stage atual, follow-up planejado.
Botão "Assumir atendimento" chama Server Action que atualiza status para handoff_required.
Botão "Enviar resposta" envia mensagem via WhatsApp API e salva no banco.
```

---

### 2.3 Dashboard de piloto

**O que construir:**
- Rota `/dashboard` com métricas do piloto
- KPIs: leads atendidos, agendamentos feitos, handoffs, leads fora do horário atendidos, custo total estimado
- Gráfico simples de conversas por dia (últimos 7 dias)

**Prompt para o agente:**
```
Criar dashboard de piloto em src/app/dashboard/page.tsx.

KPIs em cards: total de leads atendidos, avaliações agendadas, handoffs para humano,
leads atendidos fora do horário comercial (entre 18h e 8h), custo estimado total.
Tabela simples dos últimos 10 leads com status e ação da IA.
Todos os dados vêm do banco via Drizzle, sem cache por enquanto.
```

---

## Fase 3 — Piloto ativo

**Objetivo:** 30 dias com a clínica do amigo conectada, dados reais, aprendizados documentados.

### Checklist antes de ligar o piloto

- [ ] WhatsApp Business aprovado pela Meta (conta Business + número dedicado)
- [ ] BSP configurado (Twilio, Zenvia ou Meta Cloud API direto)
- [ ] Env vars de produção no Vercel
- [ ] Recepcionista treinada: sabe quando a IA vai chamar ela e como responder
- [ ] Playbook revisado com dono da clínica (horários reais, nome correto, oferta da avaliação)
- [ ] Número da recepcionista configurado para receber handoffs
- [ ] Monitorar diariamente os primeiros 7 dias

### O que documentar durante o piloto

- Quantos leads atendidos por semana
- Quantos agendamentos convertidos pela IA
- Quantos handoffs foram necessários e por quê
- Casos onde a IA errou ou respondeu mal
- Feedback da recepcionista sobre a experiência de handoff
- Screenshot de pelo menos 1 conversa bem-sucedida para social proof

---

## Fase 4 — Produto v1 real

**Objetivo:** produto que uma segunda clínica pode usar sem ajuda técnica.

### 4.1 IA real com LLM

**Quando fazer:** após validar que o playbook determinístico converte leads reais.

**Prompt para o agente:**
```
Substituir o autonomous-receptionist determinístico por chamada real ao GPT-4o-mini.

Criar src/infrastructure/adapters/agents/llm-sales-agent-gateway.ts implementando
SalesAgentGateway com prompt de sistema que incorpora o contexto da clínica
(nome, procedimentos, horário, oferta). Usar streaming para resposta mais rápida.
Manter o fallback determinístico para quando a API estiver indisponível.
```

---

### 4.2 Onboarding de clínica

**O que construir:**
- Fluxo de setup: nome da clínica, especialidade, procedimentos, horário, número WhatsApp
- Conexão guiada com WhatsApp Business
- Teste de envio de mensagem antes de ativar

**Prompt para o agente:**
```
Criar fluxo de onboarding em src/app/onboarding/ com 4 passos:
1. Dados da clínica (nome, especialidade, cidade)
2. Configuração do playbook (procedimentos oferecidos, texto da oferta de avaliação, horário de atendimento)
3. Conexão WhatsApp (instruções + campo para colar o token)
4. Teste: enviar mensagem de teste e ver resposta da IA

Salvar configuração da clínica em tabela clinics no banco.
```

---

### 4.3 Multi-clínica e autenticação

**Prompt para o agente:**
```
Adicionar autenticação ao systemops-core usando Auth.js (já instalado como @auth/core).

Provider inicial: email magic link.
Cada usuário pertence a uma clínica (tabela clinic_users).
Todas as queries do banco devem ser filtradas pela clinicId do usuário logado.
Proteger todas as rotas /inbox, /dashboard, /onboarding com middleware de auth.
```

---

### 4.4 Precificação e billing

**Modelo sugerido para validar:**
- Plano Piloto: R$297/mês — 1 número WhatsApp, até 500 conversas/mês
- Plano Clínica: R$697/mês — 2 números, até 2.000 conversas, relatórios
- Plano Pro: R$1.497/mês — ilimitado, multi-usuário, integrações

**Quando implementar:** somente após o 2º cliente pagar qualquer valor.

---

## Decisões técnicas pendentes

| Decisão | Opções | Recomendação |
|---|---|---|
| BSP WhatsApp | Twilio, Zenvia, Meta direto | Meta Cloud API direto (grátis até 1k msg/mês) |
| Banco em produção | Vercel Postgres, Neon, Supabase | Neon (free tier generoso, Postgres nativo) |
| LLM | GPT-4o-mini, Claude Haiku | GPT-4o-mini (custo menor para volume de demos) |
| Auth | Auth.js, Clerk, Supabase Auth | Auth.js (já instalado) |
| Pagamento | Stripe, Pagar.me | Pagar.me (boleto + cartão BR) |

---

## Contexto do piloto

- **Clínica:** Ximendes Odontologia (amigo do Brendon)
- **Objetivo do piloto:** validar conversão de leads fora do horário
- **Métrica principal:** avaliações agendadas pela IA no primeiro mês
- **Meta mínima:** 3 agendamentos extras para provar ROI

---

*Atualizado em 23/05/2026. Para executar qualquer fase, cole o prompt correspondente no agente e contextualize com o estado atual do projeto.*
