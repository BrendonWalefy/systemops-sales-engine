# Audit Completo de Regras e Lógica — Pipeline de Conversação

**Objetivo:** Classificar cada regra do sistema segundo quem deveria ser seu dono,
identificar onde há dono errado, e propor o local correto para cada uma.

**Princípio guia:** Nenhuma nova clínica deve exigir um deploy de código.
Se um comportamento pode variar entre clínicas, ele é DATA — não código.

---

## Os Quatro Donos Possíveis

```
🏛️  PLATAFORMA   Código — nunca muda por clínica. Segurança, mecânica, infraestrutura.
⚙️  OPERACIONAL   Tabela clinics — parâmetros de como a clínica funciona.
📋  PROCEDIMENTO  Tabela treatments — configuração de cada procedimento.
📖  EDITORIAL     Tabela playbook_versions — conteúdo e tom de comunicação.
🤖  LLM           System prompt do IntentClassifier ou ResponseComposer.
                   Só para decisões de linguagem natural — nunca negócio.
```

---

## ZONA 1 — PLATAFORMA (Código fixo — CORRETO ✅)

Estas regras estão no lugar certo. São mecânica de plataforma que não varia por clínica.

| Regra / Lógica | Arquivo | Status |
|---|---|---|
| Dedup por messageId (`messages.externalId`) | Orchestrator.ts ~680 | ✅ Correto |
| Dedup por conteúdo + phone + janela 5s | Orchestrator.ts ~695 | ✅ Correto |
| Filtro: grupo (`isGroupMsg=true`) | zapi/route.ts | ✅ Correto |
| Filtro: status reply, sticker sem texto | zapi/route.ts | ✅ Correto |
| Resolução de tenant por `zapiInstanceId` | zapi/route.ts | ✅ Correto |
| Autenticação de webhook | zapi/route.ts | ✅ Correto |
| Autenticação de cron (`CRON_SECRET`) | cron/*/route.ts | ✅ Correto |
| Transcrição de áudio via Whisper (timeout 5s) | zapi/route.ts | ✅ Correto |
| Booking saga: lock otimista → overlap → Calendar | BookingService.ts | ✅ Correto |
| Criação de evento no Google Calendar | CalendarGateway.ts | ✅ Correto |
| Rehosting de mídia (Z-API URL → Vercel Blob) | Orchestrator.ts ~581 | ✅ Correto |
| Pipeline TTS (sintetiza → blob → envia → deleta) | Orchestrator.ts | ✅ Correto |
| Push notification para operadores | Orchestrator.ts | ✅ Correto |
| Rastreamento de custo LLM (`usageCostTracker`) | Orchestrator.ts | ✅ Correto |
| Temperatura do lead por intent (cold→warm→hot) | Orchestrator.ts ~1750 | ✅ Correto |
| `consecutiveUnclearCount` tracking | Orchestrator.ts ~1723 | ✅ Mecânica OK |
| menuResolution por índice/rótulo/keyword | Orchestrator.ts ~1021 | ✅ Mecânica UI |
| procedureSelection por índice da lista | Orchestrator.ts | ✅ Mecânica UI |
| Slot offer por índice (`slotChoice`) | Orchestrator.ts | ✅ Mecânica UI |
| scheduleFollowUp após agendamento | Orchestrator.ts | ✅ Correto |

---

## ZONA 2 — OPERACIONAL / Tabela `clinics` (Config por clínica)

### ✅ JÁ EXISTE — Correto

| Campo | O que controla |
|---|---|
| `autoReplyEnabled` | Liga/desliga IA da clínica |
| `conversationExperience` | `menu_first` ou `concierge` |
| `menuItems[]` | Itens, labels e intents do menu |
| `greetingMessage` | Saudação do primeiro contato |
| `takeoverTtlHours` | TTL da pausa quando operador escreve (padrão 4h) |
| `voiceResponseEnabled` | Ativa TTS |
| `ttsConfig` (provider, voice) | Qual engine de voz usar |
| `receptionistPhone` | Quem recebe mídia do lead por WhatsApp |
| `installmentRates` | Tabela de parcelamento (base para cálculo) |
| `defaultAppointmentDurationMinutes` | Duração padrão de slots |
| `postAppointmentBufferMinutes` | Buffer após uma consulta |
| `address` | Endereço na confirmação de agendamento |
| `timezone` | Fuso horário (formata datas para LLM e UI) |
| `businessHours` | Bloqueia slots fora do expediente |
| `zapiInstanceId` | Identifica o canal de entrada |
| `googleCalendarId` | Qual agenda Google usar |
| `calendarMode` | Modo de calendário (`google` ou `local`) |

### ❌ FALTANDO — Está hardcoded no Orchestrator.ts

| Constante atual | Valor fixo | Campo proposto em `clinics` | Impacto |
|---|---|---|---|
| `RATE_LIMIT_MESSAGES_PER_HOUR` | 60 | `rateLimitPerHour` | Clínica com campanha ou clínica pequena quer limite diferente |
| `UNCLEAR_THRESHOLD` | 3 | `unclearThreshold` | Clínica de alto valor quer escalar com 2; outra aceita 5 |
| `CONVERSATION_RESTART_HOURS` | 4h | `staleConversationHours` | Clínica premium tem paciente que demora 12h para responder |
| `RAPID_LEAD_MESSAGE_THROTTLE_MS` | 4.000ms | `rapidThrottleMs` | Algumas clínicas não precisam desse throttle |
| `MAX_SLOTS_TO_OFFER` | 5 | `maxSlotsToOffer` | Clínica pode preferir 3 para forçar decisão mais rápida |
| `SLOTS_LOOKAHEAD_DAYS` | 14 dias | `slotLookaheadDays` | Algumas clínicas têm agenda de 30 dias aberta |
| Media pause TTL | `null` (permanente) | `mediaTakeoverTtlHours` | Clínica quer que IA retome após 2h sem resposta humana |
| History limit | 8 mensagens | `conversationHistoryLimit` | Clínica complexa pode precisar de mais contexto |
| Slot offer TTL | 15 min | `slotOfferTtlMinutes` | Clínica premium quer dar 30-60min para o paciente decidir |

---

## ZONA 3 — PROCEDIMENTO / Tabela `treatments` (Config por procedimento)

### ✅ JÁ EXISTE — Correto

| Campo | O que controla |
|---|---|
| `name` | Nome detectado por keyword match nas mensagens |
| `description` | Texto exibido quando lead pergunta sobre o procedimento |
| `durationMinutes` | Duração do slot no calendário |
| `requiresEvaluationFirst` | Força agendamento de avaliação antes do procedimento |

### ❌ FALTANDO — Espalhado em código e campo de texto livre

| O que falta | Onde está hoje | Campo proposto | Impacto |
|---|---|---|---|
| Texto pré-definido por procedimento | `playbook_versions.notes` via TRIGGER FORMAT (hack) | `triggerTemplate` (text nullable) | Editor de conteúdo configura por procedimento de forma estruturada |
| Liga/desliga keyword match | Hardcoded — sempre ativo | `keywordMatchEnabled` (boolean, default: true) | Procedimento com nome genérico (ex: "Consulta") dispara em qualquer mensagem |
| Palavras alternativas do paciente | Hardcoded — só o `name` exato | `aliases[]` (text array) | Lead escreve "facetas" mas procedimento é "Lentes de Porcelana" — não detecta |

---

## ZONA 4 — EDITORIAL / Tabela `playbook_versions` (Conteúdo e tom)

### ✅ JÁ EXISTE — Correto

| Campo | O que controla |
|---|---|
| `specialty` | Especialidade da clínica (contexto do LLM) |
| `toneOfVoice` | Tom de voz de todas as respostas |
| `receptionistName` | Nome da recepcionista IA |
| `commercialPolicy` | Política de preços lida literalmente pelo LLM |
| `differentials` | Diferenciais da clínica para perguntas gerais |
| `objections` | Pares objeção → resposta |
| `mediaLibrary[]` | Vídeos e fotos disponíveis para envio com `[MEDIA:id]` |
| `procedureDescription` | Descrição geral dos procedimentos |

### ⚠️ PROBLEMA — `notes` mistura editorial com roteamento

| O que tem em `notes` | Deveria estar em |
|---|---|
| Tom de voz adicional, orientações de comunicação | `notes` (correto — fica) |
| `TRIGGER [nome]: template...` | `treatments.triggerTemplate` (campo estruturado) |
| Instrução de quando enviar `[MEDIA:id]` | `notes` (OK, mas pode ser treatments.triggerTemplate também) |

---

## ZONA 5 — LLM: IntentClassifier

### ✅ CORRETO — O LLM deve fazer isso

| Decisão | Por quê é correto no LLM |
|---|---|
| Detecta qual dos 16 intents melhor descreve a mensagem | É linguagem natural — código não consegue fazer bem |
| Extrai slot preference (data, período, hora expressa) | Linguagem natural ("terça de manhã", "depois do almoço") |
| Identifica tratamento mencionado pela IA no contexto | Requer entender o contexto da conversa, não só keywords |
| Detecta `shouldAskClarification` | Julgamento sobre ambiguidade — domínio do LLM |
| Detecta `handoffReason` (por que precisa de humano) | Linguagem natural |

### ❌ PROBLEMA — IntentClassifier nunca é chamado quando código detecta keyword

```
Hoje: if (directTreatmentMention) → classificação FORÇADA para general_question
                                     LLM NÃO É CHAMADO

Correto: LLM classifica SEMPRE → resultado inclui identifiedTreatment
         Código usa identifiedTreatment para contextualizar a ação
         Keyword match vira FALLBACK se LLM não identificar tratamento
```

---

## ZONA 6 — LLM: ResponseComposer

### ✅ CORRETO — O LLM deve fazer isso

| Decisão | Por quê é correto no LLM |
|---|---|
| Fraseado natural da resposta | Linguagem natural |
| Aplicação do tom de voz (`toneOfVoice`) | Subjetivo — LLM interpreta melhor que regex |
| Espelho de saudação temporal | Linguagem natural |
| Limite de emojis | Segue tom de voz — OK no prompt |
| Não inventar datas/dados | Regra de fidelidade — OK no prompt |
| Escopo estrito (só assuntos da clínica) | Regra de safety — OK no prompt |
| Fidelidade editorial (valores exatos) | Instrução clara — OK no prompt |
| Modo áudio (60 palavras, sem markdown) | Formato de output — OK no prompt |

### ❌ PROBLEMA — ResponseComposer tomando decisões que são do sistema

| Decisão problemática | Onde está | Por que é problema | Solução |
|---|---|---|---|
| Anti-repetição (não repetir info já dita) | System prompt linha 138 | LLM decide o que omitir → imprevisível; playbook diz "SEMPRE mencione X" mas LLM suprime | Sistema deve rastrear o que foi comunicado e passar só informação nova para o LLM |
| Decide o que incluir/omitir do action result | System prompt implícito | LLM interpreta o que o Orchestrator enviou e pode omitir partes | Orchestrator deve filtrar ANTES o que passar — LLM só fraseia |
| Máximo 2 parágrafos | System prompt linha 141 | Algumas clínicas podem precisar de mais para procedimentos complexos | `clinics.maxResponseParagraphs` ou `playbook_versions.responseFormat` |

---

## ZONA 7 — ZONA CINZA: Lógica no Orchestrator que precisa ser reavaliada

Estas regras estão no código mas têm comportamento que deveria ser configurável por clínica.

| Regra | Linha aprox. | Problema | Proposta |
|---|---|---|---|
| `directTreatmentMention` força `general_question` | 1062 | BUG — sobrescreve intenção de booking. Usa keyword hardcoded | Remover. LLM classifica + retorna `identifiedTreatment`. Código usa o campo |
| `TREATMENT_MENTION_STOPWORDS` (14 palavras fixas) | 297-314 | Lista hardcoded — clínica não pode ajustar | Mover para config ou tornar parte do LLM |
| `AESTHETIC_TREATMENT_KEYWORDS` (8 palavras) | 472-475 | Lógica de "é estético?" hardcoded | Mover para `treatments.isAesthetic` (boolean) |
| `isolatedGreeting` detectado por regex | ~1012 | Threshold e palavras hardcoded | Manter no código mas tornar threshold configurável |
| `isStaleConversation` com `CONVERSATION_RESTART_HOURS` | ~1007 | Threshold fixo para todas as clínicas | Usar `clinics.staleConversationHours` |
| Media received → `aiPaused=true, takeoverExpiresAt=null` | 863 | TTL da pausa não configurável | Usar `clinics.mediaTakeoverTtlHours` |
| `RATE_LIMIT_MESSAGES_PER_HOUR = 60` | 388 | Limite não configurável | Usar `clinics.rateLimitPerHour` |
| `UNCLEAR_THRESHOLD = 3` | 391 | Threshold não configurável | Usar `clinics.unclearThreshold` |

---

## Mapa de Migração — Por Prioridade

### 🔴 Crítico (afeta booking — corrigir já)

| Item | Ação | Esforço |
|---|---|---|
| `directTreatmentMention` força `general_question` (Bug ②) | Remover detecção determinística. LLM sempre classifica. Usar `identifiedTreatment` do resultado | Médio |
| `AESTHETIC_TREATMENT_KEYWORDS` hardcoded | Mover para `treatments.isAesthetic` (boolean) | Baixo |

### 🟡 Alto (config faltando — sem isso escalar é arriscado)

| Item | Ação | Esforço |
|---|---|---|
| `RATE_LIMIT_MESSAGES_PER_HOUR = 60` | Adicionar `clinics.rateLimitPerHour` com default 60 | Baixo |
| `UNCLEAR_THRESHOLD = 3` | Adicionar `clinics.unclearThreshold` com default 3 | Baixo |
| `CONVERSATION_RESTART_HOURS = 4` | Adicionar `clinics.staleConversationHours` com default 4 | Baixo |
| `slotOfferTtlMinutes` hardcoded | Adicionar `clinics.slotOfferTtlMinutes` com default 15 | Baixo |
| Media pause sem TTL | Adicionar `clinics.mediaTakeoverTtlHours` com default null | Baixo |
| `treatments.triggerTemplate` faltando | Criar campo + migrar TRIGGER FORMAT de notes para ele | Médio |
| `treatments.keywordMatchEnabled` faltando | Criar campo boolean com default true | Baixo |

### 🟠 Médio (melhora previsibilidade mas não bloqueia escala imediata)

| Item | Ação | Esforço |
|---|---|---|
| Anti-repetição no prompt do LLM | Sistema rastreia o que foi dito; passa só informação nova | Alto |
| `treatments.aliases[]` faltando | Criar array de termos alternativos para keyword match | Médio |
| `clinics.maxSlotsToOffer` hardcoded | Adicionar campo com default 5 | Baixo |
| `clinics.slotLookaheadDays` hardcoded | Adicionar campo com default 14 | Baixo |

### 🔵 Baixo (melhoria futura)

| Item | Ação | Esforço |
|---|---|---|
| `clinics.conversationHistoryLimit` | Adicionar campo com default 8 | Baixo |
| `clinics.maxResponseParagraphs` | Adicionar campo com default 2 | Baixo |
| `clinics.rapidThrottleMs` | Adicionar campo com default 4000 | Baixo |

---

## Resumo: O que cada papel configura hoje vs ideal

```
PAPEL                 HOJE                           IDEAL
──────────────────────────────────────────────────────────────────────
Desenvolvedor         Tudo que não está no banco       Só plataforma:
                      (constants, routing, prompts)    dedup, saga, TTS,
                                                       push, calendar

Admin da clínica      autoReplyEnabled, menus,         + rateLimitPerHour,
                      greetingMessage, ttsConfig...    staleConversationHours,
                                                       slotOfferTtlMinutes,
                                                       unclearThreshold,
                                                       mediaTakeoverTtlHours

Coordenador clínico   name, description,               + triggerTemplate,
                      durationMinutes,                 + keywordMatchEnabled,
                      requiresEvaluationFirst          + aliases[]

Editor de conteúdo    toneOfVoice, commercialPolicy,   Mesmo, sem TRIGGER FORMAT
                      notes (com TRIGGER FORMAT hack)  (esse vai para treatments)

Engenharia / DevOps   OPENAI_API_KEY, ZAPI_*,         Mesmo — só infra
                      CRON_SECRET, VERCEL_BLOB...
```

---

## Bug Registrado

**BUG-001: directTreatmentMention sobrescreve intenção de agendamento**

- **Arquivo:** `src/core/pipeline/ConversationOrchestrator.ts` linha ~1062
- **Comportamento hoje:** Qualquer mensagem com nome de tratamento → `intent = general_question` (forçado) → LLM não é chamado → lead não vê horários mesmo quando claramente quer agendar
- **Exemplo:** "Quero agendar implante amanhã às 14h" → IA descreve o procedimento → lead abandona
- **Fix:** Remover `directTreatmentMention` como classificador. LLM sempre classifica. Usar `classification.slotPreference.identifiedTreatment` para enriquecer o contexto do dispatch
- **Status:** Aguardando janela para correção
- **Prioridade:** 🔴 Crítico
