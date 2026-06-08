# Análise UX — Conversas Ximendes Odontologia
**Data da análise:** 2026-06-08  
**Total de conversas analisadas:** 32  
**Período coberto:** 2026-05-27 a 2026-06-08  
**Total de mensagens:** ~490 (251 leads, 148 agente IA, 72 recepcionista humana)

---

## Resumo Executivo

A análise das 32 conversas da clínica Ximendes revelou **7 bugs críticos** no sistema de IA, **5 problemas comportamentais** da IA que prejudicam conversão, e **6 problemas de processo** que dependem de ajuste no playbook ou operação humana. Há uma lead quente (Karen) que deve ser contatada proativamente.

---

## Status de Correções (atualizado 2026-06-08)

| Bug | Status | Commit |
|-----|--------|--------|
| BUG-002: race condition resposta dupla | ✅ Corrigido | `862970d` — dedup scoped por conversationId |
| BUG-004: saudação dupla "Bom dia! Olá!" | ✅ Corrigido | `03cbada` — stripGreetingPrefix |
| BUG-001: sub-menu orphaned number | ✅ Corrigido | `bb9602d` — isOrphanedMenuNumber |
| BUG-005: slot confirmado que não existia | ✅ Corrigido | `bb9602d` — isOrphanedMenuNumber + slot guard |
| BEHAV-001: paciente chegando → menu completo | ✅ Corrigido | `9ce4bad` + `bb9602d` — patient_arrived intent |
| BEHAV-005: nome inconsistente Marina/Mariana | ✅ Corrigido | `a58c147` — identity/persona consistency |
| BUG-003: ai_paused ignorado | Investigar (pode ser resolvido em 862970d) | |
| BUG-006: IA promete enviar fotos | ✅ Corrigido | `a58c147` — needs_human para pedidos de mídia |
| BUG-007: paciente atrasando sem resposta | Processo — depende de SLA interno | |
| BEHAV-002: amnésia de clientes recorrentes | ⚠️ Parcial — stale path melhora, mas sem contexto de histórico | |
| BEHAV-003: IA agenda antes de responder dúvida | ✅ Corrigido | `9ce4bad` — concierge responde antes de oferecer agenda |
| BEHAV-004: múltiplos "oi" sem escalação | Não implementado | |
| PROC-001: Karen sem follow-up | Ação manual | |
| PROC-002: localização errada | Externo — Google Meu Negócio | |
| PROC-004: SLA para ai_paused sem resposta | Não implementado | |

### Melhorias adicionadas em 2026-06-08

- `ResponseComposer.price_inquiry`: adicionadas instruções para lidar com preço de concorrente e compra para terceiros
- `src/__tests__/XimendesConversationPatterns.test.ts`: 32 testes derivados das conversas reais (Gregorie, Fe Em Deus, Karen, Bianca, Tania Mara, Larissa, Rogger)

---

## 🔴 Bugs Críticos (Sistema Quebrado)

### BUG-001: IA quebra ao receber número de item em sub-lista de procedimentos

**Conversas afetadas:** Gregorie (04/06), Dina (04/06)

```
Gregorie pede: "Avaliação"
IA responde:   "Ops, tive um problema técnico por aqui. Pode tentar novamente? 🙏"
               (repetido 2x, mesma resposta para as 2 tentativas)

Dina: seleciona "8" da lista de procedimentos (Lentes de porcelana)
IA responde:   "Ops, tive um problema técnico por aqui. Pode tentar novamente? 🙏"
```

Fluxo quebrado: IA mostra lista numerada de 13 procedimentos → lead digita número/texto → IA falha. O sub-fluxo de seleção de procedimento específico (após o menu de 13 itens) não está tratado. **Leads abandonam no momento de mais intenção.**

**Sugestão:** Mapear o intent `procedure_detail` para sub-items (números 1-13 dentro do contexto de lista de procedimentos). Ou simplificar o fluxo evitando sub-menus com esse nível de profundidade.

---

### BUG-002: IA gera resposta dupla para a mesma mensagem

**Conversa afetada:** Larissa Sales (04/06), Fe Em Deus (03/06)

```
Larissa envia 1 mensagem detalhada → IA responde 2x idêntico, intents diferentes:
[agent] [acknowledgment] "Bom dia, Larissa Sales! Olá! Sou a recepcionista virtual..."
[agent] [price_inquiry]  "Bom dia, Larissa Sales! Olá! Sou a recepcionista virtual..."

Fe Em Deus envia 2 msgs rápidas → IA responde 2x com menu completo idêntico
```

**Causa provável:** Race condition no webhook — mensagem chega duas vezes ou dois intents são detectados para uma mesma mensagem, gerando dois processos paralelos.

**Sugestão:** Deduplicação por `external_id` no response composer também (não só no handler de entrada). Garantir que uma mensagem nunca gere mais de uma resposta de IA.

---

### BUG-003: IA ignora ai_paused e continua respondendo

**Conversa afetada:** Gregorie (30/05)

```
[17:50] 👩‍💼 RECEP: Reset       ← recepcionista tentou resetar
[17:50] 👤 LEAD: Boa tarde
[17:51] 👤 LEAD: Oi
[17:54] 👤 LEAD: Boa tarde      ← 4 mensagens sem resposta
[17:56] 👤 LEAD: Boa tarde
[17:56] 🤖 IA: Boa tarde, Gregorie! Seja bem-vindo... [menu completo]
```

A recepcionista enviou "Reset" às 17:50, mas a IA acabou respondendo ao 5º "Boa tarde" às 17:56 com o menu completo. Isso sugere que o comando "Reset" não ativou o `ai_paused` corretamente ou que havia um estado inconsistente.

**Sugestão:** Auditar o que acontece quando a recepcionista digita "Reset" — verificar se o ai_paused é setado, e se a IA tem algum mecanismo de cooldown antes de re-assumir.

---

### BUG-004: IA responde com saudação redundante dupla

**Conversas afetadas:** Fe Em Deus, Dina, Larissa, Robson, Gregorie (03-04/06)

```
"Bom dia, Fe Em Deus! Olá! Sou a recepcionista virtual da Ximendes Odontologia."
"Bom dia, Dina! Olá! Sou a recepcionista virtual da Ximendes Odontologia."
"Boa tarde, Gregorie! Olá! Sou a recepcionista virtual da Ximendes Odontologia."
```

A saudação temporal ("Bom dia, X!") e o "Olá!" são redundantes. Parece um bug de concatenação entre a saudação contextual e o template de apresentação fixo.

**Sugestão:** No ResponseComposer, garantir que a saudação contextual substitui (não precede) o "Olá!" do template. A apresentação deve ser: `"Bom dia, [Nome]! Sou a [nome], recepcionista virtual da Ximendes..."`.

---

### BUG-005: IA confirma horário que ela própria disse não existir

**Conversa afetada:** Gregorie (27/05)

```
Lead: "Tem horário para segunda dia 1 às 11h?"
IA:   "Infelizmente, não temos horário disponível para segunda-feira, dia 1, às 11h.
       Mas temos outras opções:
       1. Sex 29/05 às 12h
       2. Sex 29/05 às 11h
       3. Seg 01/06 às 13h
       4. Seg 01/06 às 11h    ← Exatamente o horário que disse não ter!
       5. Ter 02/06 às 12h"
Lead: "4"
IA:   "Seu agendamento para segunda-feira, dia 1, às 11h, está confirmado!"
```

A IA disse que Seg 01/06 às 11h não estava disponível, mas o listou como opção 4. O texto "Infelizmente não temos..." parece ser um template fixo que não verifica o resultado real da busca de slots.

**Sugestão:** Corrigir a mensagem de resposta de disponibilidade: se o horário exato não está disponível, dizer "não temos *esse* horário exato, mas os mais próximos são...". Se o horário está disponível (mesmo que com variação), dizer "Temos às 11h! Confirmar?".

---

### BUG-006: IA promete ações que não pode executar

**Conversa afetada:** EMERSON (29/05)

```
Lead: "Doutor depois me enviar as fotos por favor"
IA:   "Claro! Assim que possível, vou enviar as fotos para você."
```

A IA prometeu enviar fotos que não existem em nenhuma base de dados. O lead vai esperar e nunca receberá.

**Sugestão:** IA deve reconhecer pedidos direcionados ao doutor/equipe e responder: "Vou passar esse recado para o Dr. Gregory!" ao invés de assumir que pode executar.

---

### BUG-007: Paciente chegando/atrasando no dia da consulta não recebe resposta

**Conversa afetada:** Fe Em Deus (08/06)

```
[08/06 14:32] Lead: "Gregori acho q vou atrasar uns 5/10 min pq o Uber demorou chegar"
[08/06 14:32] Lead: "Tem algum problema"
[08/06 14:33] Lead: "?"
                    ← ZERO resposta
```

A conversa tinha `ai_paused: true` (recepcionista havia assumido), mas a recepcionista não respondeu à mensagem de atraso no dia da consulta. O paciente ficou sem retorno em um momento crítico.

**Sugestão:** Quando `ai_paused: true` e o lead envia mensagem no dia de uma consulta agendada, o sistema deve notificar proativamente a recepcionista (push notification com contexto: "Fe Em Deus está atrasando 5-10 min para a consulta das 15h").

---

## 🟡 Problemas de Comportamento da IA

### BEHAV-001: IA não reconhece paciente agendado chegando

**Conversas afetadas:** Rogger Tenorio (01/06), EMERSON (29/05)

```
Rogger: "Bom dia ! a já cheguei / Aqui😁 / Mais cedo"
IA: "Bom dia, Rogger Tenorio! Seja bem-vindo à Ximendes Odontologia. Sou a Mariana..."
    [apresenta menu completo de 5 itens]
```

Rogger tinha consulta agendada para 12h e chegou às 10:33. A IA não cruzou o status `appointment_scheduled` e exibiu o onboarding completo como se fosse um novo lead.

**Sugestão:** Quando o lead tem status `appointment_scheduled` e manda mensagem no dia/hora próximos à consulta, IA deve responder: "Ótimo, Rogger! A equipe já sabe que você chegou. Podem te chamar em instantes 😊" e notificar internamente.

---

### BEHAV-002: IA não retém contexto entre sessões (amnésia de cliente)

**Conversa afetada:** Gregorie (03-04/06)

Gregorie já era cliente (havia feito consulta em 01/06), voltou em 03/06 com "Oi" e recebeu o menu inicial completo com apresentação da IA como se fosse o primeiro contato. A IA não reconhece clientes recorrentes.

**Sugestão:** Para leads com status `appointment_scheduled` ou `in_conversation` (não-novos), a saudação deve ser diferente: "Oi, Gregorie! Que bom te ver de novo. Como posso ajudar?" ao invés da apresentação completa.

---

### BEHAV-003: IA prioriza agenda antes de responder dúvidas

**Conversa afetada:** Bianca (29/05)

```
Bianca: "Como funciona [o procedimento de lentes]?"
IA:     "Que ótimo que você está interessada! Para dar continuidade, podemos agendar...
         1. Seg 01/06 às 14h
         2. Ter 02/06 às 14h..."
```

A IA ignorou a pergunta sobre funcionamento e foi direto para o agendamento. Bianca teve que perguntar de novo. Mais tarde, perguntou sobre valores e a IA também desviou para agenda.

**Sugestão:** No Orchestrator, o intent `general_question` ou `how_it_works` deve ser respondido antes de qualquer CTA de agendamento. O fluxo correto: responder a dúvida → depois oferecer agendamento como próximo passo natural.

---

### BEHAV-004: IA não escalona após múltiplos "oi" sem engajamento real

**Conversa afetada:** Aline Morais (28/05)

```
[15:30] Lead: "Oi" → IA: "Oi, Aline! Estou aqui se você precisar de algo."
[15:30] Lead: "Oi" → IA: "Oi, Aline! Qualquer coisa é só chamar. 😊"
[15:31] Lead: [pergunta genuína sobre o trabalho]
[15:37] Lead: "Oi" → IA: "Oi, Aline! Estou aqui se precisar de mais informações. 😊"
[15:39] Lead: "Oi" → [mesma resposta]
[15:49] Lead: "Oi" → [mesma resposta]
[15:49] Lead: "Oi" → [mesma resposta]
```

Após uma conversa, a lead ficou enviando "oi" repetidamente, provavelmente esperando uma resposta da equipe. A IA respondeu 6 vezes com variações de "estou aqui" e nunca escalou para humano ou perguntou o que precisava.

**Sugestão:** Após 3 "oi" / saudações sem conteúdo em sequência, IA deve perguntar diretamente: "Aline, posso te ajudar com algo específico?" e após o 5º, transferir para humano com nota interna.

---

### BEHAV-005: Nome do assistente IA é inconsistente

**Conversas afetadas:** Múltiplas

- "Sou a **Marina**, assistente do Dr. Gregory." (Gregorie, 30/05)
- "Sou a **Mariana**, recepcionista virtual da clínica." (Rogger, 01/06)
- "Sou a **recepcionista virtual** da Ximendes Odontologia." (versão sem nome, múltiplas)

Três variações do nome/apresentação ativas simultaneamente. Isso provavelmente indica diferentes versões de prompt/playbook em uso.

**Sugestão:** Padronizar o nome no playbook e auditar se há versões antigas ativas. Escolher um nome único (ex: "Marina") e usar consistentemente.

---

## 🔵 Problemas de Processo (Operação Humana)

### PROC-001: Lead quente Karen sem follow-up agendado

**Conversa:** Karen (06/06, 40 mensagens)

Karen mostrou altíssima intenção: quer presentear o marido, perguntou sobre técnica, valores, parcelamento, mandou foto do marido, discutiu o caso detalhadamente. No final disse "Eu vou ver direitinho que dia ele pode ir fazer avaliação ok". A recepcionista respondeu "Sem problemas, Bom final de semana".

**Não houve follow-up posterior.** Hoje é 08/06 e Karen está em `waiting_response` com `ai_paused: true`.

**Ação recomendada:** Retomar contato com Karen hoje: "Oi Karen! Você conseguiu verificar a disponibilidade do seu marido para a avaliação? Temos horários essa semana 😊"

---

### PROC-002: Localização errada no Google/Instagram

**Evidência:** Karen (06/06)

```
Lead: "Gostaria de saber onde vocês estão localizados"
Lead: "Há já vi aqui é no Butantã"
Recepcionista: "Na verdade aparece Butanta na localização, mas estamos no Brooklin"
```

A clínica aparece como "Butantã" no perfil do Instagram ou no Google Maps, mas fica no Brooklin. Isso gera desconfiança e possível desistência de leads geograficamente sensíveis.

**Ação recomendada:** Corrigir a localização no Google Meu Negócio e/ou Instagram. Enquanto não corrige, incluir no playbook uma resposta rápida sobre localização.

---

### PROC-003: Conversas de fornecedores/contatos externos chegando na caixa de leads

**Conversas afetadas:** Kinho (entregador Dental Cremer), Janaína (conversa pessoal sobre venda de "mon"), Studio Zed Tattoo

Esses contatos não são leads de pacientes. Kinho era um entregador da Dental Cremer buscando quem pudesse receber a entrega. Janaína parece ser um contato pessoal da recepcionista conversando sobre uma venda. Studio Zed Tattoo está listado como lead.

**Sugestão:** 
1. Criar mecanismo de "marcar como não-lead" no Inbox para limpar a visão.
2. A IA pode ser treinada para identificar e redirecionar contatos claramente fora do contexto de odontologia.

---

### PROC-004: Múltiplas conversas em waiting_response há mais de 24h com ai_paused

Conversas com `ai_paused: true` e `last_message_at` há mais de 1 dia, sem resposta da recepcionista:

| Lead | Última msg | Status |
|------|-----------|--------|
| Carla | 07/06 12:34 | Perguntou taxa do parcelamento, recebeu resposta, ficou sem follow-up |
| . (lead sem nome) | 07/06 16:39 | Perguntou valor de lentes, recebeu resposta, ficou sem follow-up |
| Cida | 07/06 10:44 | Apenas "oi" de saudação, sem resposta |
| Renato | 07/06 18:04 | 2 mensagens sem nenhuma resposta |
| Brasil Donna | 07/06 17:14 | Conversa curta sem resposta |

Após a recepcionista assumir o controle (`ai_paused: true`), ela nem sempre responde. Os leads ficam em limbo — sem IA e sem humano.

**Sugestão:** SLA interno: conversas `ai_paused: true` com mais de 2h sem resposta devem gerar alerta para a recepcionista.

---

### PROC-005: Lembrete de consulta usa nome do contato WhatsApp, não nome real

**Conversa afetada:** Fe Em Deus (07/06)

```
"Olá Fe Em Deus! Lembrando que sua consulta é amanhã, 08/06, às 15:00."
```

"Fe Em Deus" é o nome do contato no WhatsApp, não o nome do paciente (que é Bruno). O lembrete ficou impessoal e potencialmente constrangedor.

**Sugestão:** O sistema de lembretes deve usar o nome coletado durante a conversa (se disponível) ao invés do `lead.name` do banco (que vem do display name do WhatsApp). No fluxo de agendamento, capturar e salvar o nome preferido do paciente.

---

### PROC-006: Leads sem telefone no cadastro

**Lead afetada:** Flavia (WhatsApp LID sem phone associado)

Flavia tem `phone: null` no banco. Pode ser um lead via WhatsApp Business API com LID mas sem número confirmado. Isso impede lembretes por número.

**Sugestão:** Investigar o fluxo de criação de lead para contatos com `lid` mas sem `phone`. Garantir que o resolver de identidade popula o campo `phone` ao primeiro contato.

---

## 📊 Métricas de Saúde das Conversas

| Métrica | Valor |
|---------|-------|
| Total conversas | 32 |
| Com agendamento confirmado | 3 (Gregorie, Fe Em Deus, Rogger) |
| AI paused | 11 (34%) |
| Needs attention | 1 (Robson — pediu falar com atendente) |
| Temperature inferida | 3/32 (9%) — maioria null |
| Conversas sem nenhuma resposta da IA ou humano | ~5 |
| Conversas com bug "problema técnico" | 2 (Gregorie, Dina) |
| Conversas com resposta dupla | 2 (Larissa, Fe Em Deus) |

**Temperatura null em 91% das conversas** é um sinal de que a inferência de temperatura não está funcionando para conversas com alto volume de mensagens humanas (recepcionista assume cedo e a IA não chega a inferir).

---

## Prioridade de Ação

| # | Item | Impacto | Esforço | Urgência |
|---|------|---------|---------|---------|
| 1 | BUG-001: Sub-menu de procedimentos quebrado | Alto — perde leads no pico de interesse | Médio | Hoje |
| 2 | PROC-001: Follow-up Karen | Alto — lead quente esfriando | Nenhum | Hoje |
| 3 | BUG-004: Saudação dupla | Médio — UX polished | Baixo | Esta semana |
| 4 | BUG-007: Notificar recep quando paciente chega/atrasa | Alto — experiência no dia | Médio | Esta semana |
| 5 | BUG-005: Confirmar horário indisponível | Médio — confiança | Médio | Esta semana |
| 6 | BEHAV-001: Reconhecer paciente agendado chegando | Alto — desnecessariamente robótico | Médio | Esta semana |
| 7 | BEHAV-002: Amnésia de clientes recorrentes | Médio — retenção | Alto | Próximo sprint |
| 8 | BUG-002: Resposta dupla (race condition) | Alto — spam de mensagens | Alto | Investigar |
| 9 | PROC-002: Localização errada (Butantã vs Brooklin) | Alto — marketing | Baixo (externo) | Esta semana |
| 10 | BEHAV-003: IA foca em agenda antes de responder | Médio — conversão | Médio | Próximo sprint |
| 11 | PROC-004: SLA para ai_paused sem resposta | Médio — retenção | Médio | Próximo sprint |
| 12 | BEHAV-005: Nome inconsistente (Marina/Mariana) | Baixo — branding | Baixo | Esta semana |
