# Diagramas de Arquitetura

Diagramas simples e versionáveis do SystemOps Core. As imagens PNG são geradas
pelos scripts `_gen_*.py` com `matplotlib`. As fontes Mermaid abaixo são a
versão editável e diff-ável de cada desenho.

Regenerar as imagens:

```bash
python3 docs/architecture/diagrams/_gen_system_integrations.py
python3 docs/architecture/diagrams/_gen_core_today.py
python3 docs/architecture/diagrams/_gen_core_event_driven.py
node docs/architecture/diagrams/_gen_systemops_current_drawio.mjs
```

## Arquitetura atual editável no Draw.io

[`systemops-current-architecture.drawio`](./systemops-current-architecture.drawio)
é o desenho multipágina da arquitetura viva do produto. O arquivo possui quatro
abas:

1. arquitetura técnica e integrações internas/externas;
2. microintegrações do runtime conversacional, LLMs e pipeline;
3. features, fontes de verdade e data lineage da Home;
4. campanhas de preço, reativação e automações recorrentes.

O `.drawio` é gerado sem compressão para continuar versionável e pode ser
editado diretamente no diagrams.net. Se o gerador for alterado, regenere o
arquivo com o comando Node acima.

A versão navegável para GitHub Pages vive em
[`docs/solution-site`](../../solution-site/README.md). Ela apresenta as quatro
abas como SVG, além dos princípios arquiteturais, stack, técnicas de engenharia
e features do produto.

## 1. Integrações e tenancy atuais

![Integrações](./system-integrations.png)

Visão de alto nível do produto rodando hoje: canal principal via Z-API,
compatibilidade com Meta, inbox de eventos no Postgres, workers lógicos via
cron, agenda interna/Google Calendar, IA e storage.

```mermaid
flowchart LR
    Lead([Lead no WhatsApp]) --> WA[Z-API hoje<br>Meta compat.]
    WA --> IN[/api/whatsapp/zapi<br>ingress fino/]
    IN --> EV[(inbound_events)]
    EV --> Q1[jobs<br>message.process]
    Q1 --> MW[message-worker<br>ProcessMessageJobHandler]
    MW --> ORCH[ConversationOrchestrator]
    ORCH --> Q2[(outbound_messages)]
    Q2 --> J2[jobs<br>message.send]
    J2 --> SW[sender-worker]
    SW --> WA

    ORCH <--> DB[(Postgres / Drizzle<br>multi-tenant)]
    ORCH <--> OAI[OpenAI / Whisper]
    SW <--> TTS[TTS providers]
    SW <--> BLOB[Vercel Blob]
    ORCH <--> GC[Agenda interna<br>+ Google Calendar opt-in]
    CRON[Vercel Cron] --> MW
    CRON --> SW
```

## 2. Core atual do runtime conversacional

![Core atual](./core-today.png)

O pipeline principal inbound/outbound já está desacoplado:

- webhook recebe, valida, resolve tenant, persiste e enfileira;
- `message-worker` processa a conversa principal;
- `sender-worker` entrega a outbox sem recomputar a conversa.

Exceção importante: alguns crons auxiliares ainda fazem envio direto
(`appointment-reminder`, `follow-up-dispatcher`, `recovery-campaign`).

```mermaid
flowchart TD
    A[WhatsApp provider] --> B[/api/whatsapp/zapi]
    B --> C[inbound_events]
    C --> D[jobs: message.process]
    D --> E[ProcessMessageJobHandler]
    E --> F[ConversationOrchestrator]
    F --> G[RegisterIncomingMessage]
    F --> H[ConversationStateMachine]
    F --> I[IntentClassifier]
    F --> J[BookingService / CalendarGateway]
    F --> K[ResponseComposer]
    K --> L[outbound_messages]
    L --> M[jobs: message.send]
    M --> N[SendMessageJobHandler]
    N --> O[OutboundDeliveryService / sendVoiceOrText]
    O --> P[WhatsApp provider]
```

## 3. Mapa de evolução para a arquitetura 2.0

![2.0 planning map](./core-event-driven.png)

Este desenho não descreve o runtime atual; ele explicita o eixo de evolução
recomendado para a 2.0 multi-tenant e multi-segmento.

Ideias centrais:

- manter tenancy, inbox/outbox e retry como base;
- generalizar o domínio exposto (`organization`, `service`, `resource`);
- tratar agenda como capability opcional;
- permitir múltiplos canais sem mudar o miolo de decisão;
- preservar a regra: o LLM entende e verbaliza; o sistema decide.

```mermaid
flowchart LR
    CH[Channel adapters<br>WhatsApp hoje, outros depois] --> ING[Ingress + tenant resolution]
    ING --> BUS[Event bus / durable jobs]
    BUS --> CW[Conversation / automation workers]

    CW --> CFG[(Tenant config<br>editorial + policies + segment pack)]
    CW --> DOM[Deterministic domain modules]
    DOM --> SCH[Scheduling capability]
    DOM --> KB[Knowledge / commercial capability]
    DOM --> HAN[Handoff / operational capability]

    CW --> OUT[(Outbox)]
    OUT --> DEL[Delivery workers]
    DEL --> CH

    CW -.-> OBS[Tracing + metrics + audit]
    DEL -.-> OBS
```
