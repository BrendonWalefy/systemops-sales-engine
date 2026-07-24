# SystemOps Core

> Recepcionista comercial com IA para clínicas. Responde no WhatsApp, qualifica leads, agenda consultas, envia lembretes e entrega o painel — sem depender de horário humano.

Produção: https://app.systemops.com.br

---

## O Problema

Clínicas perdem dinheiro antes mesmo de atender o paciente.

Um lead manda mensagem no WhatsApp às 21h perguntando o preço de um procedimento. A recepção não está online. Ele não espera — vai para a próxima clínica. No dia seguinte, quando alguém responde, o interesse evaporou.

Os problemas que esse ciclo gera são sistêmicos:

- **Leads sem resposta** — mensagens que chegam fora do horário comercial ou em pico de volume ficam dias sem retorno.
- **Qualificação manual e repetitiva** — toda recepcionista responde as mesmas perguntas de preço, procedimento e disponibilidade centenas de vezes por mês.
- **Agendamento por WhatsApp é um jogo de ping-pong** — o lead pede horário, a recepção verifica a agenda, oferece, o lead não responde, a recepção esquece. O slot fica vago.
- **Sem dados** — o dono não sabe quantos leads entram, quantos viram consulta, quantos somem sem resposta.
- **Recepcionistas sobrecarregadas** — passam o dia apagando incêndios em vez de focar em atendimento de valor.

O resultado: receita perdida que nunca aparece no relatório porque a clínica nem sabe o que deixou de ganhar.

---

## A Solução

SystemOps é uma recepcionista comercial com IA que opera 24/7 pelo WhatsApp da clínica.

Ela não é um chatbot de respostas fixas. É um agente que entende o contexto da conversa, consulta a agenda em tempo real, aplica a política comercial configurada pela clínica e só aciona um humano quando a situação realmente exige julgamento.

O fluxo completo, do primeiro "oi" até o agendamento confirmado, acontece de forma autônoma:

1. Lead manda mensagem no WhatsApp.
2. A IA identifica a intenção: interesse em procedimento, pergunta de preço, pedido de horário.
3. Responde com as informações certas, no tom certo, com o nome configurado pela clínica.
4. Oferece slots reais da agenda (sem inventar horários).
5. Confirma o agendamento e registra no sistema.
6. Envia lembrete automático D-1 para reduzir no-shows.
7. Se o lead some, dispara follow-up de reengajamento.
8. Se a conversa exige humano — dor, urgência, negociação fora da política — pausa a IA e notifica a equipe em tempo real.

A recepção humana entra apenas nos casos que realmente precisam dela.

---

## Multi-Segmento

SystemOps não é um produto exclusivo para odontologia.

A camada de inteligência — classificação de intents, composição de respostas, regras de handoff — é parametrizada por clínica. Cada clínica define:

- Especialidade (odontologia, dermatologia, oftalmologia, medicina geral, estética, etc.)
- Procedimentos e preços
- Política comercial e condições de pagamento
- Tom de voz e nome da recepcionista virtual
- Regras de quando acionar humano

Uma nova clínica de qualquer segmento é onboardada via painel do owner, sem alterar uma linha de código. A IA se adapta ao contexto configurado.

---

## Features

### Recepcionista com IA (Core)

- **Classificação de intenção em 16 categorias** — desde `greeting` e `price_inquiry` até `clinical_urgency` e `needs_human`, com confiança e extração de tratamento mencionado.
- **Debounce de mensagens** — agrupa bursts de mensagens antes de processar, evitando respostas parciais e interrompidas.
- **Temperatura de leads** — infere e eleva interesse (frio → morno → quente) a partir das intenções ao longo da conversa. Nunca rebaixa automaticamente.
- **Suporte a áudio** — transcreve mensagens de voz via Whisper (OpenAI) e responde em texto.
- **Suporte a mídia** — processa imagens, documentos e vídeos recebidos; classifica e responde contextualmente.

### Agendamento

- **Agenda interna própria** — slots, agendamentos e bloqueios vivem no banco. Nenhuma dependência externa obrigatória.
- **Google Calendar como opt-in** — clínicas que já usam GCal podem conectar; o sistema resolve por `calendarMode`.
- **Anti-double-booking** — lock otimista via `SlotReservationService` garante que dois leads não confirmem o mesmo horário simultaneamente.
- **Reagendamento e cancelamento** — fluxo completo pelo WhatsApp, sem intervenção humana.
- **Lembrete D-1** — cron automático (13h UTC) envia lembrete 20-32h antes da consulta, idempotente via `reminderSentAt`.

### Máquina de Conversão com Vídeos

- **Pipeline declarativo por procedimento** — cada tratamento pode ter um fluxo de conteúdo: vídeo educativo → perguntas de qualificação → captura de foto → oferta de agenda.
- **TTS com voz shimmer** — a recepcionista pode enviar áudios sintetizados com voz personalizada.
- **Biblioteca de mídia** — upload via Vercel Blob, envio por `[MEDIA:id]` no playbook, rastreado no inbox com badge.
- **Iniciação de pipeline por menção** — se o lead menciona um tratamento com pipeline configurado, o fluxo inicia automaticamente, inclusive na saudação inicial.

### Inbox e Smart Handoff

- **Smart Inbox em 3 seções** — Atenção Humana (takeover ativo), Em Conversa (IA operando), Histórico (encerradas).
- **Pausa manual da IA** — a equipe pode pausar a IA em qualquer conversa e retomar quando quiser.
- **TTL configurável por clínica** — conversas paradas há X horas retornam automaticamente para a IA.
- **Takeover por unclear consecutivo** — se a IA não entende a mensagem mais de N vezes seguidas, pausa e notifica o humano.
- **Notificações push** — PWA com push nativo no browser; badge "Recepção" na aba.
- **Envio manual pelo inbox** — equipe responde direto da interface sem sair para o WhatsApp.

### Follow-up e Reengajamento

- **Follow-up automático** — leads que somem depois de demonstrar interesse recebem mensagem de reengajamento no horário certo.
- **Campanha de recuperação** — leads frios com agendamento cancelado ou expirado entram em régua de recuperação (cron 12h e 21h em dias úteis).
- **Aba Recuperação no Inbox** — equipe vê leads dormentes, gera mensagem por IA e envia direto.

### Playbook e Configuração da IA

- **Editor de playbook** — campos estruturados: nome da recepcionista, saudação, tom de voz, política comercial, notas adicionais.
- **Co-escritor com IA (PlaybookAdvisor)** — sugere melhorias no playbook baseado nas conversas reais da clínica.
- **Lint em tempo real** — detecta preços, condições de pagamento e objeções no campo errado (ex: em `notes` em vez de `commercial_policy`) e exibe aviso âmbar.
- **Simulador de IA** — sandbox `/playbook/simulate` com toggle Produção/Rascunho para testar o comportamento da IA antes de publicar.
- **Publicação com validação** — playbook só vai para produção se passar no checklist de campos obrigatórios.

### Calendário Interno

- **Visualização por profissional** — agenda com filtro por recurso (dentista, dermatologista, etc.).
- **Bloqueios de agenda** — equipe bloqueia horários diretamente no painel.
- **Timezone por clínica** — sem configuração global; cada clínica tem seu fuso explícito no banco.

### Painel Owner

- **Status operacional por clínica** — `prospect → test → active → paused → cancelled`, com timestamps e histórico.
- **Clinic Blueprint** — leitura de prontidão por bloco: identidade, canal, agenda, playbook, tratamentos, comercial, go-live. Cada bloco tem link de ação direto.
- **Diagnóstico rápido** — formulário de 2 steps para criar uma nova clínica prospect em menos de 2 minutos.
- **Qualidade da IA** — métricas diárias por clínica: `unclear_rate`, `takeover_rate`, `conversion_rate`, `pipeline_completion_rate`. Alertas automáticos quando limites são ultrapassados.
- **Painel financeiro** — custos reais, planos ativos, margem por clínica.
- **Alertas operacionais** — régua única por clínica ativa: configuração incompleta, cron com falha, webhook silencioso, qualidade de IA abaixo do limite.
- **Digest diário por email** — resumo operacional enviado 9h UTC via Resend.

### Segurança e Infraestrutura

- **Criptografia AES-256-GCM** — tokens Z-API, Z-API Client e Meta Access Token encriptados em repouso. Chave gerenciada via `CREDENTIAL_ENCRYPTION_KEY` no Vercel.
- **Rate limiting por clínica** — proteção contra uso abusivo da API de IA.
- **Multi-tenant por design** — cada clínica é isolada por `clinicId`. Nenhum dado vaza entre tenants.
- **E2E em produção** — `scripts/e2e-webhook-test.ts` dispara o webhook real e valida estado no banco; integrado ao GitHub Actions.

---

## Para Vendas e Marketing

> Esta seção descreve o produto em linguagem de negócio para uso em roteiros de vídeo, apresentações e materiais de propaganda.

### O que é o SystemOps

SystemOps é o primeiro membro da equipe que nunca falta, nunca se atrasa e nunca deixa um lead sem resposta.

É uma recepcionista virtual com inteligência artificial que opera pelo WhatsApp da sua clínica 24 horas por dia, 7 dias por semana. Ela conversa como uma profissional treinada, conhece todos os procedimentos da clínica, consulta a agenda em tempo real e confirma agendamentos — sozinha, sem precisar de nenhuma intervenção humana para os casos comuns.

### A dor que ela resolve

Toda clínica tem o mesmo problema invisível: leads que entram pelo WhatsApp e saem sem resposta. A recepção está ocupada, ou é fim de semana, ou o volume de mensagens é maior do que a equipe consegue processar. Esses leads somem — e a clínica nunca sabe o que perdeu.

O SystemOps elimina esse gap. Do "oi" até a consulta marcada, o processo acontece de forma autônoma.

### Como funciona na prática

Imagine que um paciente manda mensagem às 22h perguntando sobre o preço de lentes de contato dentais. Em vez de silêncio, ele recebe uma resposta em segundos: a recepcionista virtual apresenta o procedimento, explica a política comercial da clínica e pergunta se ele quer ver os horários disponíveis. Em minutos, o horário está confirmado. No dia seguinte, ele recebe um lembrete automático.

A equipe chega na segunda-feira e o paciente já está na agenda.

### O que a IA faz sozinha

- Responde perguntas sobre procedimentos, preços e condições de pagamento
- Verifica disponibilidade na agenda e oferece horários reais
- Confirma, cancela e remarca consultas
- Envia lembretes automáticos para reduzir no-shows
- Manda vídeos explicativos e áudios com voz humanizada
- Faz follow-up com leads que sumiram
- Qualifica o nível de interesse de cada lead ao longo do tempo

### O que fica com o humano

A IA sabe quando não deve agir. Em casos de dor, urgência, reclamação, negociação especial ou qualquer situação sensível, ela pausa e notifica a equipe com contexto completo. A recepcionista humana entra já sabendo o que aconteceu — sem precisar reler toda a conversa.

### Por que não é um chatbot comum

Chatbots seguem fluxos fixos. Se o paciente sai do roteiro, o bot trava. O SystemOps entende linguagem natural, interpreta contexto, adapta a resposta e toma decisões — como uma profissional treinada faria. A diferença é que ela opera em escala, em paralelo, para todos os leads ao mesmo tempo.

### Para qualquer tipo de clínica

O SystemOps não foi feito só para odontologia. A plataforma é configurável por segmento: clínicas de dermatologia, oftalmologia, estética, medicina geral e qualquer especialidade podem usar o mesmo produto com a personalidade, os procedimentos e a política comercial da sua clínica.

---

## Arquitetura

### Princípio central

> O LLM entende e verbaliza; o sistema decide.

O LLM nunca toma decisões de negócio diretamente. Ele classifica intenção e compõe texto. Quem decide o que fazer — consultar agenda, confirmar slot, pausar IA, acionar humano — é código determinístico.

### Camadas

| Camada | Pasta | Responsabilidade |
|---|---|---|
| Domain | `src/domain/` | Entidades, value objects, contratos de repositório |
| Application | `src/application/` | Use cases, ports, serviços de aplicação |
| Core | `src/core/` | Pipeline de conversa, agenda, state machine, inteligência |
| Infrastructure | `src/infrastructure/` | Drizzle, Google Calendar, Z-API, OpenAI, push, crypto |
| App | `src/app/` | UI Next.js, route handlers, server actions |

### Fluxo de mensagem

```
WhatsApp Z-API
  → POST /api/whatsapp/zapi
  → resolveClinicByZapiInstance()         # resolve tenant pelo zapiInstanceId
  → persistInboundEventAndEnqueue()       # grava inbound_events + job message.process

/api/cron/message-worker
  → ProcessMessageJobHandler
  → ConversationOrchestrator.handle()
     → RegisterIncomingMessage
     → ConversationStateMachine
     → IntentClassifier                   # LLM → JSON estruturado
     → regra determinística por intent    # código decide
     → BookingService / repositories
     → ResponseComposer                   # LLM → texto humanizado
     → enqueueOutboundMessage()           # grava outbound_messages + job message.send

/api/cron/sender-worker
  → SendMessageJobHandler
  → OutboundDeliveryService / sendVoiceOrText()
  → Z-API envia texto / áudio / mídia
```

### Modelo de execução atual

O runtime atual é um **monólito modular com pipeline híbrido assíncrono**:

- webhook fino: recebe, valida, resolve tenant, persiste e enfileira;
- `message-worker`: processa a conversa principal com `ConversationOrchestrator`;
- `sender-worker`: entrega a saída usando outbox e retry;
- algumas automações de cron ainda fazem envio direto e serão candidatas a
  unificação na arquitetura 2.0.

### State machine de conversa

O estado operacional vive em `conversation_states`. Transições possíveis:

```
active ←→ ai_paused (takeover manual ou automático)
active → stale (TTL expirado sem interação)
stale → active (lead volta a interagir)
```

Estado nunca é inferido de texto de mensagem ou memória volátil.

### Multi-tenancy

Cada clínica tem configuração própria no banco:

- Credenciais Z-API (encriptadas)
- Compatibilidade opcional com Meta Cloud API
- Modo de calendário (`internal` ou `google_calendar`)
- Timezone explícito
- Horários comerciais
- Profissionais e seus recursos de agenda
- Tratamentos com duração, pipeline e flag de mídia
- Playbook ativo com versão publicada
- Segmento e linguagem do negócio (`specialty`, `segment`, `serviceNoun`)
- Limites e políticas da IA

Não existe fallback global. Cada requisição resolve seu tenant antes de qualquer processamento.

---

## Stack

| Categoria | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router, React 19) |
| Linguagem | TypeScript 5.8 (strict) |
| Banco | PostgreSQL via Neon (serverless) |
| ORM | Drizzle ORM + Drizzle Kit |
| IA | OpenAI `gpt-4o-mini` (classificação + composição), Whisper (áudio), PlaybookAdvisor |
| Voz | TTS via OpenAI, Google Neural2, ElevenLabs, Fal/Kokoro |
| WhatsApp | Z-API por clínica, com compatibilidade para Meta Cloud API |
| Storage | Vercel Blob (mídia, áudio TTS) |
| Email | Resend (digest operacional, alertas) |
| Push | Web Push API + VAPID |
| Calendário | Agenda interna própria + Google Calendar (opt-in) |
| Execução assíncrona | `inbound_events` + `jobs` + `outbound_messages` no Postgres |
| Deploy | Vercel (Pro) |
| Crons | Vercel Cron + GitHub Actions (cleanup TTS sub-diário) |
| Testes | Vitest (lógica de negócio em `src/__tests__`) |
| Criptografia | AES-256-GCM para credenciais sensíveis em repouso |

---

## Metodologias

### Arquitetura limpa por camadas

Domain, Application, Core e Infrastructure são camadas com fronteiras explícitas. Nenhuma camada interna importa de camada externa. Route handlers são adapters finos — validam entrada, resolvem contexto e delegam.

### LLM como ferramenta, não como árbitro

A IA classifica e verbaliza. Decisões de negócio — reservar slot, pausar conversa, acionar humano — são código determinístico com cobertura de testes. Isso garante previsibilidade e auditabilidade.

### Config-first, sem hardcoding

Qualquer comportamento que pode variar por clínica vai no banco com default no schema. Nunca em variável de ambiente ou constante no código. Uma clínica nova não requer alteração de código.

### Multi-tenant desde o primeiro dia

Todas as entidades carregam `clinicId`. Toda query filtra por tenant. Não existe dado global que vaze entre clínicas.

### Migrations reprodutíveis

Baseline único em `drizzle/0000_baseline.sql`. Novas alterações via `npm run db:generate`. `drizzle-kit push` proibido em produção.

### Testes na lógica, E2E no comportamento

Lógica de negócio em `src/__tests__` com Vitest (pura, sem mock de banco). Comportamento de ponta a ponta via `scripts/e2e-webhook-test.ts` disparando o webhook real de produção e validando estado no banco.

---

## Rotas Principais

### Área da Clínica (`/app/*`)

| Rota | Descrição |
|---|---|
| `/app/dashboard` | KPIs da clínica |
| `/app/inbox` | Conversas: atenção humana, IA ativa, histórico |
| `/app/inbox/[conversationId]` | Chat, pausa da IA, agendamento manual |
| `/app/agenda` | Agenda, slots e bloqueios |
| `/app/settings/playbook` | Editor de playbook, simulador, co-escritor IA |
| `/app/settings/tratamentos` | CRUD de procedimentos e pipeline |
| `/app/settings/profissionais` | Profissionais e recursos de agenda |

### Owner (`/owner/*`)

| Rota | Descrição |
|---|---|
| `/owner` | Visão consolidada de todas as clínicas |
| `/owner/clinics/novo` | Diagnóstico rápido — cria clínica prospect em 2 steps |
| `/owner/clinics/[clinicId]` | Detalhe, Blueprint, checklist de go-live |
| `/owner/clinics/[clinicId]/blueprint` | Blueprint multi-dispositivo com blocos de prontidão |
| `/owner/financeiro` | Custos reais, planos e margem |
| `/owner/qualidade` | Métricas diárias de qualidade da IA por clínica |

### APIs Operacionais

| Rota | Descrição |
|---|---|
| `POST /api/whatsapp/zapi` | Webhook Z-API (produção) |
| `GET /api/cron/message-worker` | Worker lógico da fila `message.process` |
| `GET /api/cron/sender-worker` | Worker lógico da fila `message.send` |
| `POST /api/conversations/[id]/send` | Envio manual pelo inbox |
| `/api/cron/*` | Rotinas protegidas por `CRON_SECRET` |
| `/api/health` | Healthcheck — filtra apenas clínicas `active` |
| `/api/e2e/*` | Rotas de teste destrutivas — só com `E2E_MODE=true` fora de produção |

### Crons em produção

| Cron | Horário | Função |
|---|---|---|
| `message-worker` | `* * * * *` | Drena `message.process` e chama o orquestrador |
| `sender-worker` | `* * * * *` | Drena `message.send` e entrega a outbox |
| `stale-conversations` | 6h UTC diário | Fecha conversas com TTL expirado |
| `follow-up-dispatcher` | 10h UTC diário | Envia follow-ups de reengajamento |
| `appointment-reminder` | 13h UTC diário | Lembrete D-1 de consultas |
| `appointment-reminder-staff` | 21h UTC diário | Lembretes internos para equipe |
| `calendar-watch-renew` | 5h UTC toda segunda | Renova watch do Google Calendar |
| `recovery-campaign` | 12h UTC (seg–sáb) | Campanha de recuperação de leads frios |
| `recovery-campaign-evening` | 21h UTC (seg–sex) | Segunda janela da campanha de recuperação |
| `conversation-analytics` | 8h UTC diário | Agrega métricas de qualidade por clínica |
| `conversation-insights` | 7h UTC diário | Consolida insights de conversa |
| `operational-alert-digest` | 9h UTC diário | Digest operacional por email |
| `metrics-aggregate` | 2h UTC diário | Consolida métricas gerais |
| `media-cleanup` | 4h UTC diário | Apaga do Blob mídia inbound (imagem/vídeo/documento/áudio) com +90 dias e zera `media_url`; texto/transcrição da mensagem é preservado |

---

## Setup Local

```bash
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

### Scripts úteis

```bash
npm run verify            # lint + typecheck + testes
npm run verify:agenda     # testes focados em agenda/calendário
npm run db:generate       # gera migration a partir do schema
npm run db:migrate        # aplica migrations usando .env.local
npm run create-clinic     # cria clínica via script de onboarding
npm run seed              # seed local da Ximendes
npm run replay:export -- --clinic <slug> --dataset-version <versao> --out-dir <diretorio-absoluto-fora-do-git>
```

---

## Variáveis de Ambiente

Env é para infraestrutura compartilhada. Configuração de clínica fica no banco.

| Variável | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL/Neon |
| `SESSION_SECRET` | Assinatura das sessões |
| `OWNER_EMAIL` | Login do owner |
| `OWNER_PASSWORD` | Senha do owner |
| `OPENAI_API_KEY` | Classificação, composição, Whisper e TTS |
| `CREDENTIAL_ENCRYPTION_KEY` | Chave AES-256-GCM para tokens de clínica |
| `CRON_SECRET` | Proteção das rotas cron |
| `TOGGLE_SECRET` | Proteção de toggles operacionais |
| `SIMULATE_API_KEY` | Acesso ao sandbox de simulação |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Push notifications no browser |
| `VAPID_PRIVATE_KEY` | Push notifications no servidor |
| `VAPID_SUBJECT` | Identidade VAPID |
| `RESEND_API_KEY` | Emails transacionais e digest |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account GCal (só modo `google_calendar`) |
| `GOOGLE_PRIVATE_KEY` | Chave privada GCal (só modo `google_calendar`) |
| `DECISION_TRACE_MODE` | Opcional: `structured_log` para metadados de trace; omitido = desligado |
| `REPLAY_EXPORT_ALLOWED_CLINICS` | Allowlist local de slugs autorizados para export do corpus |
| `REPLAY_EXPORT_HASH_KEY` | Chave local de 32+ caracteres para pseudonimizar IDs do corpus |

---

## Banco e Migrations

- Baseline reprodutível: `drizzle/0000_baseline.sql`
- Novas alterações: `npm run db:generate` → revisar → `npm run db:migrate`
- Produção: `npm run db:migrate` no deploy. Nunca `drizzle-kit push`.

Detalhes em [docs/operations/migrations-baseline.md](docs/operations/migrations-baseline.md).

---

## Documentação

- [Arquitetura atual](docs/architecture/current.md)
- [Replay e Decision Trace](docs/architecture/replay-and-decision-trace.md)
- [Diagramas de arquitetura](docs/architecture/diagrams/README.md)
- [Arquitetura alvo 2.0](docs/architecture/target-architecture.md)
- [Infraestrutura de mídia](docs/architecture/media-infrastructure.md)
- [Prontidão multi-segmento](docs/product/multi-segment.md)
- [Change control e deploy safety](docs/operations/change-control.md)
- [Onboarding de clínica](docs/operations/onboarding-clinica.md)
- [Posicionamento do produto](docs/product/positioning.md)
- [Guia de UX para agentes](docs/agent-guides/saas-ux-strategy.md)

---

## Regras de Trabalho

`main` é produção e `develop` é a branch de integração. Para mudanças normais:

1. Atualizar `develop`.
2. Criar branch focada a partir de `develop`.
3. Rodar `npm run verify`.
4. Abrir PR para `develop` e validar preview.
5. Promover `develop` para `main` só depois de validação completa.

Regras completas em [AGENTS.md](AGENTS.md).
