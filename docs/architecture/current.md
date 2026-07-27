# Arquitetura Atual

Este documento descreve a arquitetura viva do SystemOps Core em 2026-07-26.
Histórico, prompts de implementação e planos antigos não devem ser usados como
fonte de verdade.

## Resumo executivo

Hoje o SystemOps é um **monólito modular em Next.js** com execução
**híbrida**:

- entrada de mensagens já é **event-driven**;
- processamento conversacional principal roda em **workers lógicos** via cron;
- entrega de saída usa **outbox + sender worker**;
- respostas e automações destinadas ao lead usam a mesma **outbox durável**;
- notificações internas ao responsável ainda usam um caminho operacional
  separado.

Em uma frase: o webhook deixou de ser o lugar onde tudo acontece, mas a
plataforma ainda não unificou todos os fluxos assíncronos sob o mesmo pipeline.

## Princípio central

> O LLM entende e verbaliza; o sistema decide.

- `IntentClassifier` classifica a mensagem em JSON estruturado.
- `ConversationOrchestrator` aplica regras determinísticas e executa a ação
  real.
- `ResponseComposer` transforma o resultado concreto em texto humano.

Playbook, tom de voz e mídia influenciam comunicação. Eles não podem alterar
regras de agenda, reserva, disponibilidade, tenant ou segurança.

Uma clínica pode ter no máximo um `playbook_versions.status = active`. A troca
de versão é atômica e protegida no banco; a publicação também impede que
comandos de workflow sejam plantados em `notes`, pois fluxo e mídia pertencem
ao pipeline estruturado do tratamento.

## Fluxo principal de mensagem

```text
WhatsApp (Z-API hoje, Meta como compatibilidade)
  -> POST /api/whatsapp/zapi
  -> resolveClinicByZapiInstance()
  -> persistInboundEventAndEnqueue()
     -> inbound_events
     -> jobs(queue = "message.process")

/api/cron/message-worker
  -> ProcessMessageJobHandler
  -> ConversationOrchestrator.handle()
     -> RegisterIncomingMessage
     -> ConversationStateMachine
     -> IntentClassifier
     -> regra determinística por intent
     -> BookingService / repositories / CalendarGateway
     -> ResponseComposer
     -> enqueueOutboundMessage()
        -> outbound_messages
        -> jobs(queue = "message.send")

/api/cron/sender-worker
  -> SendMessageJobHandler
  -> OutboundDeliveryService / sendVoiceOrText()
  -> Z-API envia texto, mídia ou áudio
```

### Correlação e Decision Trace

O fluxo principal propaga um `turnId` do `inboundEventId` até a outbox e o
sender. A captura detalhada é injetável e permanece desligada por padrão; o
runtime pode emitir metadados estruturados com
`DECISION_TRACE_MODE=structured_log`, sem corpo de mensagem, prompt, telefone
ou nome.

Os contratos, limites de privacidade e o estado incremental da implementação
estão em
[`docs/architecture/replay-and-decision-trace.md`](replay-and-decision-trace.md).
O endpoint antigo de exportação bruta de conversas reais está desativado e não
é parte da arquitetura suportada.

O endpoint Meta Cloud API (`/api/whatsapp/webhook`) existe como compatibilidade,
mas a produção atual usa Z-API como canal principal. Mensagens de texto da Meta
também são persistidas em `inbound_events` antes de entrar no mesmo worker. Todo
POST da Meta é autenticado sobre o corpo bruto com `x-hub-signature-256` e o
`metaAppSecret` criptografado da clínica; segredo ausente ou assinatura inválida
falham fechado antes de qualquer persistência.

## O que já está assíncrono

### Ingress fino

`POST /api/whatsapp/zapi` já não executa toda a jornada conversacional. Ele:

1. autentica o webhook;
2. resolve a clínica;
3. ignora grupos, status e ecos já conhecidos;
4. persiste o payload bruto em `inbound_events`;
5. enfileira `message.process`;
6. responde rápido.

### Processamento por worker

`/api/cron/message-worker` drena a fila `message.process` e entrega cada evento
para `ProcessMessageJobHandler`, que:

- recupera o evento bruto;
- normaliza o payload;
- aplica policy de automação;
- transcreve áudio quando necessário;
- chama `ConversationOrchestrator`.

### Outbox de saída

O `ConversationOrchestrator` não envia mais diretamente a resposta principal do
lead. Ele grava a intenção de envio em `outbound_messages` e enfileira
`message.send`.

Quando a resposta consome um passo de pipeline, o avanço é revisionado e
registrado logo após a outbox durável, antes de liberar o claim da conversa. A
coluna `conversation_states.supersedes_state_id` impede dois workers de consumir
a mesma revisão; o sender mantém uma aplicação idempotente como reconciliação.

`/api/cron/sender-worker` é responsável por:

- respeitar ordem por conversa;
- entregar texto, mídia e áudio;
- persistir `providerMessageId`;
- aplicar retry sem recomputar a conversa inteira.

## Modos de automação

- `live`: a clínica está ativa, `autoReplyEnabled=true` e o motor pode decidir,
  persistir estado e enfileirar respostas;
- `observe`: `shadowModeEnabled=true`; o sistema registra a mensagem real e
  notifica a equipe, mas encerra antes de classificação, mudança de funil,
  agenda, follow-up ou resposta da IA;
- `disabled`: não executa automação conversacional.

O comportamento hipotético de uma clínica em observação é validado pelo replay
em banco sandbox. Nesse ambiente, o fluxo completo de produção roda contra
adapters de captura, sem WhatsApp, calendário externo ou storage real. Shadow
online não é simulador e não deve ser usado como evidência de qualidade da IA.

## O que ainda é híbrido

Respostas da IA, envio manual pelo inbox, follow-ups, campanhas de recuperação,
lembretes ao lead, pós-atendimento e confirmação de sinal passam por
`outbound_messages` + `message.send`.

Notificações internas para o WhatsApp do responsável (alerta de foto, pedido de
revisão humana e resumo de agenda) ainda chamam o adapter do canal diretamente.
Elas não são respostas ao lead e não devem ser forçadas a uma conversa falsa;
o destino futuro é uma outbox operacional própria, com retry e idempotência.

## Camadas

| Camada | Pasta | Responsabilidade |
| --- | --- | --- |
| Domain | `src/domain/` | Entidades, value objects e contratos de repositório |
| Application | `src/application/` | Use cases, ports, jobs e serviços de aplicação |
| Core | `src/core/` | Pipeline de conversa, agenda, state machine e inteligência |
| Infrastructure | `src/infrastructure/` | Drizzle, calendário interno/Google Calendar, canais, OpenAI, push, storage |
| App | `src/app/` | UI Next.js, route handlers, server actions e crons HTTP |

Route handlers devem continuar finos: validar entrada, resolver contexto,
delegar, retornar.

## Persistência operacional

Tabelas centrais para o runtime atual:

- `clinics`: tenant, credenciais de canal, timezone, parâmetros operacionais,
  `segment`, `serviceNoun`, `calendarMode`;
- `leads`, `conversations`, `messages`: trilha viva da conversa;
- `inbound_events`: inbox bruto e reprocessável do canal;
- `jobs`: fila durável no Postgres (`message.process`, `message.send`,
  `followup.dispatch`);
- `outbound_messages`: outbox com ordenação por conversa;
- `appointments` e `calendar_blocks`: agenda interna;
- `playbook_versions`: editorial ativo por clínica.

## Multi-tenancy

Cada clínica possui sua própria configuração no banco:

- credenciais de canal (`zapiInstanceId`, `metaPhoneNumberId`, tokens);
- modo de calendário (`calendarMode`);
- timezone;
- horários comerciais;
- profissionais;
- tratamentos;
- playbook;
- parâmetros operacionais e limites;
- política explícita de exceção fora do expediente;
- nomenclatura de domínio (`specialty`, `segment`, `serviceNoun`).

Resolução de tenant depende do contexto:

- webhook: pela credencial do canal;
- UI autenticada: pela sessão do membro/owner;
- crons: iterando explicitamente todas as clínicas.

Não existe fallback global de Z-API, calendário ou usuário de clínica por env.

## Multi-segmento: estado atual

A base já suporta operação por clínica com diferenças de segmento sem mudar o
core de tenancy:

- `clinics.segment` classifica o tipo do negócio;
- `clinics.serviceNoun` adapta a linguagem da UI e partes do conteúdo;
- `treatments` e `professionals` são genéricos o bastante para múltiplos
  serviços;
- playbook, tom e política comercial já vêm do banco por clínica.

Os limites atuais para expansão multi-segmento estão concentrados em três
lugares:

1. o domínio ainda é nomeado como `Clinic`, `Treatment`, `Professional`;
2. intents e prompts ainda são fortemente orientados a atendimento com
   agendamento no WhatsApp;
3. parte das automações ainda assume clínica/consulta como centro do fluxo.

## Agenda e reservas

Componentes principais:

- `ClinicTimezone`: única fonte para conversão e formatação de fuso;
- `SlotEngine`: pure function para disponibilidade;
- `InternalCalendarGateway`: usa `appointments` + `calendar_blocks`;
- `GoogleCalendarGateway`: modo opt-in/legado;
- `resolveCalendarGateway`: escolhe o gateway por `clinics.calendarMode`;
- `SlotReservationService`: lock otimista anti-double-booking;
- `BookingService`: saga reserva -> CalendarGateway -> banco.

Não crie agendamentos diretamente no Google Calendar fora do `BookingService`.
Bloqueios devem passar pela port `CalendarGateway`.

## Estado de conversa

Estado operacional fica em `conversation_states`, via
`ConversationStateMachine`.

Não inferir estado a partir de texto de mensagem, marcadores escondidos, cache
local ou variáveis em memória.

## Inteligência

Pontos autorizados de LLM no fluxo principal:

- `src/core/intelligence/IntentClassifier.ts`
- `src/core/intelligence/ResponseComposer.ts`
- `src/core/intelligence/PlaybookAdvisor.ts`
- `src/infrastructure/adapters/ai/whisper-gateway.ts`

Há também gateways auxiliares de IA para TTS e recomendações operacionais, mas
as decisões principais continuam cercadas por código determinístico.

## Guardrails para a arquitetura 2.0

Se a 2.0 generalizar o produto para múltiplos segmentos e tenants, estes
invariantes devem permanecer:

- o LLM não decide ações de negócio finais;
- tenant sempre é resolvido antes de qualquer leitura/escrita relevante;
- configuração por clínica/tenant vive no banco, não em env global;
- timezone e agenda passam por `ClinicTimezone` e `BookingService`;
- toda entrega importante precisa de trilha persistida e retry seguro;
- conteúdo editorial e regra operacional não podem ser duplicados.

## Leitura recomendada para desenhar a 2.0

- `docs/architecture/diagrams/README.md`
- `docs/architecture/sources-of-truth.md`
- `docs/product/multi-segment.md`
- `docs/operations/change-control.md`
