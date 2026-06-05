# omniQA — WhatsApp Real Com Segunda Clinica

Este modo complementa o sandbox `/api/playbook/simulate`. Ele usa webhook,
persistencia, estado de conversa, agenda interna e envio Z-API reais, mas
mantem os testes fora da Ximendes.

## Clinica De Validacao

- Nome: `BW odontologia`
- Slug: `bw-odontologia`
- `isTest = true`
- `calendarMode = internal`
- `conversationExperience = concierge`
- `autoReplyEnabled = true`

A BW odontologia funciona como uma segunda clinica completa para validacao real.
Ela nao possui credenciais Z-API proprias. Usa `whatsapp_qa_routes` para
enviar pelos tokens da clinica fonte apenas quando o telefone do lead esta
allowlistado.

`isTest = true` deixa a clinica fora do MRR e do custo fixo no financeiro
enquanto ela estiver em validacao; nao altera o comportamento da conversa.

## Telefones Allowlistados

| Telefone | Uso |
| --- | --- |
| `5511940617713` | Aline whatsapp clinica / recepcao QA |
| `5511953628848` | Lead testes (Brendon) |
| `5511954368563` | Gregorie, lead testes |

Mensagens desses telefones que chegam pela instancia Z-API da Ximendes sao
registradas na BW odontologia. Outros telefones continuam indo para a Ximendes.

## O Que Este Modo Valida

- webhook Z-API real;
- dedupe por `messageId` e por conteudo;
- pausa humana via `fromMe`;
- persistencia de lead, conversa e mensagens;
- **calendario interno como fonte de verdade principal** (banco de dados, sem Google Calendar);
- slots, bloqueios, criacao, cancelamento e reagendamento via InternalCalendarGateway;
- envio real pelo canal WhatsApp compartilhado;
- follow-up e lembrete quando o lead esta allowlistado.

## Como Reproduzir Conversas Reais

1. Escolha uma conversa real da Ximendes que expôs problema.
2. Copie somente as mensagens do lead, em ordem.
3. Reenvie o mesmo texto a partir de um dos numeros allowlistados.
4. Compare a resposta, intent, estado de conversa e agenda gerada na BW.
5. Se o comportamento for ruim, transforme a sequencia em teste automatizado
   antes de corrigir producao.

Nao use novos leads reais da Ximendes para regressao. A Ximendes pode continuar
captando mensagens reais, mas o teste de comportamento deve acontecer na BW com
telefones controlados.

## Diferenca Para O Simulate

`/api/playbook/simulate` e rapido e barato para validar linguagem/intents, mas
nao testa canal, estado persistido nem webhook. O modo WhatsApp real e o caminho
para cenarios criticos antes de voltar a operar em producao.

---

## Mapa de Cenarios de Teste

### Cenario 1 — Primeiro Contato (Golden Path)

**Trigger:** lead envia primeira mensagem.
**Sequencia:**
```
Lead: Olá! Tenho interesse em saber mais sobre os procedimentos.
IA:   [greetingMessage concierge — sem menu forçado]

Lead: Quero saber sobre lentes de resina
IA:   Resposta informativa com CTA para avaliação
      intent: price_inquiry ou general_question

Lead: Quero agendar uma avaliação
IA:   "Qual periodo te atende melhor — manhã ou tarde?"
      intent: book_appointment

Lead: Manhã, sexta se possível
IA:   Slots de sexta (interno, sem Google Calendar)
      intent: check_availability

Lead: 1
IA:   Confirmacao do agendamento
      intent: confirm_slot
```
**O que validar:** appointment criado no banco com `source=app`, `calendarEventId=null`.

---

### Cenario 2 — Lead Com Consulta Passada Tenta Agendar Novamente (Bug Gregorie)

**Contexto real:** Gregorie tinha consulta em 01/Jun. Voltou em 04/Jun querendo
agendar de novo. Ao responder "Avaliação" após o agente perguntar o procedimento,
recebeu "Ops, tive um problema técnico" duas vezes.

**Sequencia:**
```
Lead: Oi
IA:   [saudacao + menu]

Lead: 2  (Agendar consulta)
IA:   Pergunta qual procedimento

Lead: Avaliação
IA:   ESPERADO: lista de slots disponíveis para Avaliação (60min)
      ATUAL:    "Ops, tive um problema técnico" — BUG
```
**O que validar:**
- `resolveTreatmentDuration("Avaliação", treatments, 60)` deve retornar `{kind:"matched"}`
- `InternalCalendarGateway.listAvailableSlots()` nao deve crashar para lead com `appointment_scheduled`
- O status stale `appointment_scheduled` com consulta passada deve ser tratado como `in_conversation`
- Nenhum erro tecnico para o lead quando ele simplesmente responde o nome do procedimento

---

### Cenario 3 — Reagendamento (Cancel + Rebook)

**Trigger:** lead com appointment ativo quer trocar o horario.
**Sequencia:**
```
Lead: Quero remarcar minha consulta
IA:   "Sua consulta está marcada para [data]. Quer que eu verifique novos horários?"
      intent: reschedule_appointment

Lead: Sim
IA:   Lista de novos slots (calendario interno)

Lead: 2
IA:   Confirmacao — appointment antigo cancelado, novo criado
```
**O que validar:**
- `BookingService.cancel()` para appointment com `calendarEventId=null` nao chama gateway externo
- Novo appointment criado com `source=app`
- Lead volta para `appointment_scheduled` com novo horario

---

### Cenario 4 — Dupla Mensagem Rapida (Bug Fe Em Deus)

**Contexto real:** Fe Em Deus enviou "Boa tarde Gregori blz" e "Aqui e o Bruno da Aline"
em 5 segundos. Recebeu duas saudacoes identicas.

**Sequencia para reproduzir:**
```
Lead: Boa tarde
[espera 2s]
Lead: Aqui e o Bruno
```
**O que validar:**
- Apenas UMA resposta do agente deve ser enviada
- O throttle de 4s deve silenciar o segundo webhook
- `shouldThrottleAgentResponse(lastAgentMsg, now, 4000) === true` para o segundo webhook

---

### Cenario 5 — Selecao Numerica de Lista Secundaria (Bug Dina)

**Contexto real:** Dina enviou "8" para selecionar "Lentes de porcelana (facetas)"
da lista de 13 procedimentos. Recebeu "Ops, tive um problema tecnico".

**Sequencia:**
```
Lead: 1  (ver procedimentos)
IA:   Lista com 13 itens numerados

Lead: 8  (quer info sobre Lentes de porcelana)
IA:   ESPERADO: info sobre lentes de porcelana
      ATUAL:    "Ops, tive um problema técnico" — BUG
```
**O que validar:**
- Numero "8" apos lista de procedimentos deve ser tratado como `general_question` (item 8)
- Nao deve crashar quando o numero esta no range valido da lista

---

### Cenario 6 — Numero Fora do Range do Menu

**Sequencia:**
```
Lead: Oi
IA:   [menu 1-5]

Lead: 7
IA:   ESPERADO: "Nao entendi. Pode escolher entre as opcoes 1 a 5?"
                ou tratado como unclear → resposta educada
```
**O que validar:**
- Numero fora do range do menu nao crasha
- Intent `unclear` ou resposta educada
- `consecutive_unclear_count` incrementa se repetir

---

### Cenario 7 — Needs Human (Pedido de Especialista)

**Sequencia:**
```
Lead: 5  (Falar com atendente)
IA:   "Entendi! Ja avisei a equipe..."
      intent: needs_human
      ai_paused: true
      needs_attention: true
      attention_reason: "Lead solicitou falar com um especialista"

Lead: Boa noite [voltou horas depois, TTL venceu]
IA:   [retoma com flag resumedFromHumanTakeover]
```
**O que validar:**
- `ai_paused = true`, `needs_attention = true` apos `needs_human`
- TTL expira → lead retorna → IA responde com flag de retomada
- Sem TTL (pause manual do dashboard) → IA permanece em silencio

---

### Cenario 8 — Proposta de Troca / Acordo Informal

**Contexto real:** Lead que propoe trocar servico por tratamento (necessita atendimento humano).
**Sequencia:**
```
Lead: Caso queira vir fazer sua tattoo, depois marcamos as lentes
IA:   ESPERADO: needs_human — reconhece a proposta, passa para humano
      intent: needs_human

Lead: Tenho uma situacao especial para o pagamento
IA:   needs_human — negocia especial requer humano
```
**O que validar:**
- Proposta de troca → `needs_human` (nao `unclear`)
- `handoffReason` captura o pedido especifico do lead
- IA nao inventa condicoes ou precos na resposta de handoff

---

### Cenario 9 — Horario Fora do Expediente

**Sequencia:**
```
Lead: Tem horario hoje as 20h?
IA:   "O atendimento de hoje ja encerrou. Posso verificar os horarios de amanha?"

Lead: Pode ser amanha de manha
IA:   Slots de amanha pela manha (calendario interno)
```
**O que validar:**
- `outsideBusinessHours = true` retorna mensagem educada, sem crash
- `SlotEngine` nao oferece slots fora do `businessHours`

---

### Cenario 10 — Sabado Com Horario Reduzido

**Contexto:** Ximendes atende sabados das 8h as 13h.
**Sequencia:**
```
Lead: Tem horario sabado a tarde?
IA:   "Nosso atendimento no sabado vai ate as 13h. Posso verificar a manha?"

Lead: Sim, pode ser sabado de manha
IA:   Slots de sabado: 8h, 9h, 10h, 11h, 12h (ate 12h, pois 13h e o fim)
```
**O que validar:**
- `saturdayEndHour: 13` → ultimo slot disponivel e `12:00` (60min)
- `"13:00"` nao aparece na lista (SYS-AGENDA-020)

---

### Cenario 11 — Audio Com autoReply Ligado

**Sequencia:**
```
Lead: [envia audio de voz]
IA:   Transcreve o audio → processa a intencao → responde
```
**O que validar:**
- `WhisperGateway` transcricao integrada
- Transcricao processada como mensagem normal
- Fallback para "[audio recebido]" se transcricao falhar e `autoReply=false`

---

### Cenario 12 — Conversa em Fluxo Hibrido (IA + Humano)

**Sequencia:**
```
Lead: Boa tarde Gregori blz
IA:   [saudacao]

clinic_user: Olá Bruno, próximos horários disponíveis...
  [operador assume via telefone — fromMe=true → ai_paused=true + TTL 4h]

Lead: Pode ser segunda as 15
clinic_user: Agendamento confirmado segunda dia 08/06 às 15h

Lead: Valeu
  [sem resposta da IA — ainda dentro do TTL de 4h]

[4h depois, TTL vence]
Lead: Boa tarde
IA:   [retoma — resumedFromHumanTakeover=true]
```
**O que validar:**
- Operador responde via WhatsApp → `ai_paused=true`, `takeoverExpiresAt` setado
- TTL vence → IA responde com contexto de retomada
- Appointment confirmado manualmente aparece no banco (se operador usa dashboard)

---

## Bugs Confirmados em Producao (2026-06-03 a 2026-06-04)

| # | Lead | Sequencia | Bug | Status |
|---|------|-----------|-----|--------|
| 1 | Gregorie | `appointment_scheduled` → "Oi" → "2" → "Avaliação" | "Ops, tive problema tecnico" | Coberto em BW Session 002 |
| 2 | Fe Em Deus | Duas mensagens em 5s | Duas saudacoes identicas enviadas | Coberto em BW Session 002 |
| 3 | Larissa Sales | Duas mensagens em 2s | Duas conversas criadas | Corrigido/coberto em BW Session 003 |
| 4 | Dina | "8" apos lista de 13 procedimentos | "Ops, tive problema tecnico" | Reforçado com catálogo Ximendes em BW Session 003 |
| 5 | Gregorie | "9" duas vezes apos lista de procedimentos | Sem resposta (silencio) | Coberto por lista ativa + bypass de throttle; reforçar com item 9 se regressar |

Para reproduzir qualquer bug, usar a sequencia exata descrita no cenario correspondente
a partir dos telefones allowlistados na BW Odontologia.

## Ordem De Execucao Recomendada

Execute os cenarios nesta ordem:

1. Cenario 1 (Golden Path) — valida que o happy path funciona
2. Cenario 9 (Horario fora expediente) — valida SlotEngine basico
3. Cenario 10 (Sabado) — valida horario reduzido
4. Cenario 7 (Needs Human) — valida handoff + TTL
5. Cenario 3 (Reagendamento) — valida cancel + rebook interno
6. Cenario 2 (Bug Gregorie) — reproduz crash de "Avaliacao"
7. Cenario 4 (Bug Fe Em Deus) — reproduz dupla saudacao
8. Cenario 5 (Bug Dina "8") — reproduz crash por selecao numerica
9. Cenarios 6, 8, 11, 12 — cobertura adicional

Se qualquer cenario de 6-9 falhar, abrir issue antes de corrigir producao e
adicionar teste automatizado em `src/__tests__/`.
