# Fluxo Completo de Processamento de Mensagem

Diagrama interativo: [conversation-flow.xml](./conversation-flow.xml)

Abrir em [app.diagrams.net](https://app.diagrams.net) → Arquivo → Abrir do computador → `conversation-flow.xml`

---

## Estágios do Pipeline

```
📱 Mensagem do Lead (WhatsApp)
   ↓
① WEBHOOK Z-API  src/app/api/whatsapp/zapi/route.ts
   Filtra: grupo / statusReply / sticker → descarta
   Verifica: autoReplyEnabled → se false, só notifica
   Verifica: fromMe → se operador, pausa IA (aiPaused=true, TTL)
   ↓
② ORQUESTRADOR  src/core/pipeline/ConversationOrchestrator.ts
   Dedup: messageId + conteúdo 5s
   Carrega: clinic + resolveActiveEditorialConfig() + CalendarGateway
   Registra: lead + conversa + mensagem (author=lead)
   Mídia visual (img/vid/doc)? → rehost Blob + notifica + pausa IA permanente
   IA pausada? → TTL expirou? → retoma | senão ignora
   Rate limit >= 60/h? → ignora
   Carrega histórico: últimas 8 mensagens
   ↓
③ CLASSIFICAÇÃO  src/core/intelligence/IntentClassifier.ts
   Determinística (sem LLM, prioridade máxima):
     menu ativo → resolve por número/label
     lista de procedimentos → resolve por índice
     menção de tratamento → keyword match
     comandos especiais: /reset, menu, voltar
     gap >= 4h → conversa stale
     throttle rápido < 4s
   LLM (gpt-4o-mini, só se nenhuma resolução determinística):
     16 intents: book_appointment, check_availability, confirm_slot,
     reject_slots, cancel_appointment, reschedule_appointment,
     list_appointments, price_inquiry, clinical_urgency, needs_human,
     patient_arrived, general_question, greeting, acknowledgment,
     farewell, unclear
   ↓
④ DISPATCH  (dentro do Orchestrator — por intent)
   book/check_availability → fetchAndOfferSlots() (janela +2h/+14 dias, TTL 15min)
   confirm_slot           → SAGA BookingService.book() (lock → overlap → Calendar → appointment)
   reject_slots           → busca alternativa por preferência
   cancel                 → BookingService.cancel()
   reschedule             → cancel + fetchAndOfferSlots()
   needs_human            → aiPaused=true (permanente) + needsAttention + notifica
   clinical_urgency       → needsAttention + notifica
   patient_arrived        → aiPaused=true (permanente) + needsAttention + notifica
   price_inquiry          → commercialPolicy + installmentTable
   general_question       → contexto de tratamento / localização / playbook
   greeting               → saudação + menu (menu_first) ou pergunta aberta (concierge)
   unclear                → clarificação; 3 consecutivos → needsAttention
   ↓
⑤ COMPOSIÇÃO  src/core/intelligence/ResponseComposer.ts
   TRIGGER FORMAT no notes? → entrega determinística (zero LLM)
   Senão: LLM gpt-4o-mini (temp 0.5, max 350 tokens)
   Produz: text + parts ([MEDIA:id] resolvidos em text|media intercalados)
   Salva agentMessage no BD ANTES do envio
   ↓
⑥ ENVIO  src/lib/channel/ ou src/lib/zapi/
   TTS habilitado  → sintetiza áudio → Vercel Blob → WhatsApp áudio → deleta Blob
   Mídia intercalada → envia partes em sequência (vídeo → scheduleFollowUp)
   Senão            → sendTextMessage()
   ↓
⑦ PÓS-ENVIO
   Atualiza: externalId, deliveryFormat
   Push notification operadores
   Rastreia custo LLM
   unclear >= 3 → needsAttention
   Atualiza temperatura do lead (nunca rebaixa: cold→warm→hot)
```

---

## Onde Está Cada Configuração

| O que mudar | Onde |
|---|---|
| Ligar/desligar IA da clínica | `clinics.autoReplyEnabled` |
| Tipo de conversa (menu vs concierge) | `clinics.conversationExperience` |
| Itens do menu | `clinics.menuItems[]` |
| Primeira saudação | `clinics.greetingMessage` |
| TTL do takeover humano | `clinics.takeoverTtlHours` (padrão 4h) |
| Ativar voz (TTS) | `clinics.voiceResponseEnabled` + `clinics.ttsConfig` |
| Quem recebe mídia do lead | `clinics.receptionistPhone` |
| Parcelamento | `clinics.installmentRates` |
| Duração padrão de slot | `clinics.defaultAppointmentDurationMinutes` |
| Buffer pós-consulta | `clinics.postAppointmentBufferMinutes` |
| Endereço na confirmação | `clinics.address` |
| Timezone da clínica | `clinics.timezone` |
| Tom de voz / nome da recepcionista | `playbook_versions.toneOfVoice` / `.receptionistName` |
| Política comercial e preços | `playbook_versions.commercialPolicy` |
| Orientações / TRIGGER FORMAT | `playbook_versions.notes` |
| Biblioteca de mídia ([MEDIA:id]) | `playbook_versions.mediaLibrary[]` |
| Procedimentos e duração | `treatments.*` |
| Avaliação obrigatória antes do tratamento | `treatments.requiresEvaluationFirst` |
| Rate limit, TTL de slots, gap stale | Constantes em `ConversationOrchestrator.ts` |

---

## Quando a IA é Pausada

| Evento | TTL | Retoma automaticamente? |
|---|---|---|
| Operador envia mensagem | `clinics.takeoverTtlHours` | Sim |
| Lead envia foto/vídeo/documento | null (permanente) | Não |
| `needs_human` | null (permanente) | Não |
| `patient_arrived` | null (permanente) | Não |
| Pausado manualmente no Inbox | config | Sim (quando TTL expira) |

---

## Arquivos-chave

| Arquivo | Responsabilidade |
|---|---|
| `src/app/api/whatsapp/zapi/route.ts` | Entry point, filtros, fromMe, mídia, áudio Whisper |
| `src/core/pipeline/ConversationOrchestrator.ts` | Coordena todo o pipeline |
| `src/core/intelligence/IntentClassifier.ts` | LLM → 16 intents (só quando necessário) |
| `src/core/intelligence/ResponseComposer.ts` | LLM → humaniza resposta (conteúdo + mídia) |
| `src/core/booking/BookingService.ts` | SAGA de agendamento (reserva + Calendar + appointment) |
| `src/core/booking/SlotFetchingService.ts` | Busca e filtra slots disponíveis |
| `src/core/state/ConversationStateMachine.ts` | Estado transient (menu, slots, procedure_list) |
| `src/core/editorial/resolveActiveEditorialConfig.ts` | Fonte única do playbook ativo |
| `src/app/api/cron/appointment-reminder/route.ts` | Lembrete D-1 (janela +20h/+32h) |
| `src/app/api/cron/follow-up-dispatcher/route.ts` | Follow-up video_sent e reengagement |
