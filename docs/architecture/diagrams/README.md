# Diagramas de Arquitetura

Diagramas simples e versionáveis do SystemOps Core. As imagens PNG são geradas
pelos scripts `_gen_*.py` (matplotlib). As fontes Mermaid abaixo são a versão
editável/diff-ável de cada desenho.

Regenerar as imagens:

```bash
python3 docs/architecture/diagrams/_gen_system_integrations.py
python3 docs/architecture/diagrams/_gen_core_today.py
python3 docs/architecture/diagrams/_gen_core_event_driven.py
```

---

## 1. Integrações e jornada da mensagem

![Integrações](./system-integrations.png)

Visão de alto nível: por onde o lead entra, o core de decisão e as integrações
reais (OpenAI/GPT, TTS, Postgres, Vercel Blob, Google Calendar, Push/Crons).

```mermaid
flowchart LR
    Lead([Lead no WhatsApp]) --> ZAPI[Z-API\nprovedor WhatsApp]
    ZAPI --> WH[/api/whatsapp/zapi\nwebhook/]
    WH --> SO{{SystemOps Core\nNext.js na Vercel}}
    SO -->|resposta texto/áudio/mídia| ZAPI
    SO <--> DB[(Postgres / Drizzle\nmulti-tenant)]
    SO <--> OAI[OpenAI\nGPT intent+resposta\nWhisper áudio]
    SO <--> TTS[TTS\nOpenAI / Google / Kokoro]
    SO <--> GC[Google Calendar\nopt-in]
    SO <--> BLOB[Vercel Blob\nmídia/áudio]
    SO --> PUSH[Push + Crons\nalertas / follow-up]
```

---

## 2. Core HOJE (síncrono)

![Core hoje](./core-today.png)

A jornada inteira roda dentro de **uma request HTTP** em
`POST /api/whatsapp/zapi`: filtro/dedupe → registro → state machine →
debounce/rate limit → `IntentClassifier` (LLM) → dispatch determinístico →
`BookingService` → `ResponseComposer` (LLM) → TTS opcional → envio via Z-API →
push + tracking. **Não há fila, worker dedicado nem outbox.** O Postgres é a
fonte de verdade e o estado da conversa.

Consequências: webhook pesado, risco de timeout, várias chamadas externas em
sequência e retry/idempotência limitados.

```mermaid
flowchart TD
    A["Z-API (WhatsApp in)"] --> B
    subgraph REQ["POST /api/whatsapp/zapi — síncrono, bloqueia até terminar"]
      B["Filtro + dedupe"] --> C["RegisterIncoming"]
      C --> D["State machine"]
      D --> E["Debounce + rate limit"]
      E --> F["IntentClassifier (LLM 1)"]
      F --> G["Dispatch determinístico"]
      G --> H["BookingService (saga)"]
      H --> I["ResponseComposer (LLM 2)"]
      I --> J["TTS opcional"]
      J --> K["send via Z-API"]
      K --> L["Push + custo"]
    end
    H <--> GC["Google Calendar (opt-in)"]
    F <--> OAI["OpenAI / Whisper / TTS"]
    I <--> OAI
    B <--> PG[("Postgres — source of truth + estado")]
    C <--> PG
    D <--> PG
    K --> M["WhatsApp out"]
```

---

## 3. Core FUTURO (orientado a eventos)

![Core event-driven](./core-event-driven.png)

Alinhado a [`../target-architecture.md`](../target-architecture.md) e
[`../aws-target-architecture.md`](../aws-target-architecture.md):

- **Ingress fino**: recebe, valida, persiste em `inbound_events` (inbox) e
  responde `200` rápido.
- **Fila durável** (`message.process`) desacopla entrada de processamento, com
  retry, backoff, DLQ e ordem por conversa.
- **Conversation Worker** roda a jornada (dedupe, estado, LLM in/out, agenda) e
  grava a intenção em `outbound_messages` (outbox).
- **Fila `message.send` + Sender Worker** entregam no canal sem recomputar a
  conversa.
- **Scheduler** (EventBridge/cron) → `followup.dispatch` reaproveita o
  Conversation Worker.
- **Observabilidade** com `traceId`/`conversationId` rastreia cada etapa.

Mapa de fila: simples = `pg-boss` no mesmo Postgres; AWS = `SQS FIFO + DLQ`.

```mermaid
flowchart LR
    A["Z-API / Meta"] --> B["Ingress API\nwebhook fino · 200 OK"]
    B --> C[("inbound_events\ninbox · replay")]
    C --> D["Fila durável\nmessage.process\nFIFO por conversa"]
    D --> E["Conversation Worker\ndedupe · estado · LLM · agenda"]
    E --> F[("outbound_messages\noutbox")]
    F --> G["Fila durável\nmessage.send"]
    G --> H["Sender Worker\nentrega + retry"]
    H --> I["Canal WhatsApp"]

    E <--> J["OpenAI / Whisper / TTS"]
    E <--> K[("Postgres + S3/Blob")]
    SCH["Scheduler\nEventBridge / cron"] --> FU["followup.dispatch"]
    FU --> E

    E -.-> OBS["Observabilidade\ntraceId · status por etapa"]
    H -.-> OBS
    B -.-> OBS
```
