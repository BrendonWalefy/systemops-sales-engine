# Plano unificado de correção conversacional — 21/07/2026

Tabela única, priorizada, com a solução recomendada por caso. Base: 855 conversas reais /
867 mensagens da IA (Ximendes 27/05→20/07, Vitalli 09/07→20/07), conversas de teste excluídas.

Evidências em [mapa-comportamento-conversas-vitalli.md](./mapa-comportamento-conversas-vitalli.md)
e [objetividade-conversacional-diagnostico.md](./objetividade-conversacional-diagnostico.md).

## A causa dominante: perda de contexto

A hipótese "a IA perde o contexto / não lê antes de responder" **se confirma no código**, e tem
**três mecanismos distintos** — cada um exige uma correção diferente:

| Mecanismo | Onde | O que faz |
|---|---|---|
| **M1 — janela de inatividade** | `ConversationOrchestrator:4246` — `gapHours >= clinic.staleConversationHours` | Lead que volta depois de 4h (Vitalli) / 6h (Ximendes) é tratado como **conversa nova** |
| **M2 — semântica de "primeiro contato"** | `:4022` — `isFirstMessage = allMessages.filter(m => m.author !== "lead").length === 0` | Mede *"ninguém respondeu ainda"*, não *"é a 1ª mensagem do lead"*. Lead que manda 4 mensagens sem resposta continua "primeiro contato" |
| **M3 — truncamento pós-reset** | `:4033` — `allMessagesForContext` | Após reset, classifier e composer só veem mensagens pós-reset (TTL 2h) |

**Números que sustentam M1:** o gap p90 entre mensagens consecutivas do mesmo lead é de **17 horas**
(n=3.183). Com o limite em 4h, **17,2% de todas as respostas de lead** disparam "conversa nova".
Subindo para 24h isso cai para **5,9%** — redução de 66% sem código.

**Números que sustentam M2:** 8 dos 36 openers no meio da conversa (22%) tinham **zero** mensagens
não-lead antes.

## Tabela unificada de correção

Prioridade = impacto no funil ÷ risco. **P0** = fazer primeiro.

| P | # | Problema | Evidência | Solução recomendada | Esforço | Risco |
|---|---|---|---|---|---|---|
| **P0** | 1 | Lead que volta após 4–6h recebe saudação de abertura em vez de continuidade | 17,2% dos gaps ≥ 4h; p90 = 17h | **Subir `staleConversationHours` para 24h** nas duas clínicas. É config por clínica — só dado, sem deploy. Depois avaliar 48h. | trivial | 🟢 |
| **P0** | 2 | Lead com várias mensagens sem resposta é tratado como primeiro contato | Remedido 21/07: **123** primeiras respostas com o lead já em 2+ mensagens; **69 (56%)** abriram com apresentação | ✅ **Feito (parcial):** `isConversationOpening` separa "abrir" de "apresentar-se", e um guard pós-composição descarta a abertura quando o lead fala de novo. **Teto de ~33%** — ver abaixo: em 46 dos 69 a 2ª mensagem sequer existia no banco. | baixo | 🟢 |
| **P0** | 3 | 774 leads (98,5%) parados em `waiting_response` | §7 diagnóstico | Cobertura: varredura que responde/reengaja quem ficou sem resposta. É onde está a receita perdida. | médio | 🟡 |
| **P1** | 4 | Pedido explícito de agendamento cai em `general_question` | 3 de 7 (43%): *"Me agenda dia 8/8"* → horário de funcionamento | **Guard determinístico** de pré-classificação: frases de agendamento explícito ("me agenda", "podemos marcar", "quero agendar" + data) roteiam direto para o fluxo de slots, sem passar pela LLM. | baixo | 🟢 |
| **P1** | 5 | Pergunta de horário fora do expediente vira beco sem saída | 11 msgs / 5 convs, repetida em 4: *"posso ir após as 18h?"* → *"Seg-Sáb 8h-18h."* | Ao detectar horário **fora** da janela, nunca só informar o expediente: responder o limite **e ofertar os horários mais próximos**. Espelha o que a operadora faz. | baixo | 🟢 |
| **P1** | 6 | Lead já deu data **e** hora, sistema pede confirmação numérica | 1 de 19 ofertas numéricas: *"Dia 28/07 as 16h"* → lista de **um item** + *"responda apenas com o número"* | ✅ **Feito:** com data+hora do lead e **um único** horário casando, a resposta vira confirmação direta (*"Consigo sim: Ter 28/07 às 16h. Posso confirmar?"*). O "sim" já resolve o slot pendente pelo caminho normal. | baixo | 🟢 |
| **P1** | 7 | Quantidade que continua pergunta de preço perde o assunto | **3 de 6** casos: *"Tem 13 lentes"* → `acknowledgment`; *"Das 20 lente"* → `general_question` | ✅ **Feito:** guard `isQuantityFollowupToPriceQuestion` portado do W4.2 e ligado à coerção de intent. **Premissa original revisada:** os "6 que viraram needs_human" eram mídia para avaliação — comportamento correto, não falha. Das 256 continuações curtas, 18% já herdam `price_inquiry` e 11% `confirm_slot`. | baixo | 🟢 |
| **P2** | 8 | Duas personas na mesma conversa | *"recepcionista virtual"* + *"Marina, assistente virtual"* | Unificar: o texto do opener deve derivar de `receptionistName`, nunca ter nome embutido. Ver `persona-config-drift`. | baixo | 🟢 |
| **P2** | 9 | Paciente em tratamento tratado como lead novo | áudio: *"como eu comecei a usar…"* → opener | Resolvido em grande parte por #1 e #2. Complemento: lead com agendamento ativo/histórico nunca recebe opener de primeiro contato. | baixo | 🟢 |
| **P2** | 10 | Preço + parcelamento na mesma frase não vira `price_inquiry` | Reauditado 21/07: **0 de 9** falham hoje (ver abaixo) | ✅ **Já resolvido** por guards que entraram depois da medição original. Reauditado contra o código atual: as 9 frases reais chegam a `price_inquiry`. Só foi adicionado teste de regressão. | — | 🟢 |
| **P2** | 11 | Texto idêntico repetido na mesma conversa | 34 casos (máx. 2x) | Dedupe determinística: não reenviar bloco de conteúdo já enviado na mesma conversa. | médio | 🟡 |
| **P3** | 12 | 7% das respostas saem sem intent classificado | 64 de 867 | Instrumentar: registrar e alertar. Sem intent não há guard nem métrica. | baixo | 🟢 |
| **P3** | 13 | Sistema nunca registra "não entendi" | `consecutiveUnclearCount = 0` em 100% | Fazer o classificador emitir baixa confiança e acionar `needs_human` antes de responder errado com segurança. | médio | 🟡 |
| **P3** | 14 | Parcelamento classificado como `clinical_urgency` | 1 caso | Teste de regressão travando pagamento ≠ urgência. | trivial | 🟢 |
| **P1** | 15 | Default do debounce abaixo do gap real da rajada | 45 de 763 rajadas (6%) respondidas uma a uma; gap mediano da rajada = 10s vs default de 5s | ✅ **Feito:** default de plataforma extraído para `DEFAULT_MESSAGE_DEBOUNCE_MS` e elevado de 5s para 15s (~40% → ~67% de cobertura). Falta limpar o override de 7s da Vitalli para ela herdar o default. | trivial | 🟢 |
| **P2** | 16 | Guard de rajada não é observável | 8 openers escapam sem explicação | Instrumentar o guard antes de mexer nele: registrar descarte e passagem. | baixo | 🟢 |
| **P1** | 18 | Sábado respondido pela config, não pela agenda real | Mesma pergunta, respostas opostas com 1 dia de diferença (ver abaixo) | ✅ **Feito:** o ramo institucional passou a consultar a agenda real do sábado e ofertar os horários, reusando `fetchAndOfferSlots`. **Causa real era gramatical**, não arquitetural. | baixo | 🟢 |
| **P1** | 19 | `parseBusinessHours` só sabe decidir o sábado | NC Beauty cadastra "Terça a sexta" e o parser devolve `[1..6]`; domingo nunca é representável | Segunda a sexta é **assumido**, não lido. O sistema oferta segunda-feira para quem não abre segunda. Ler os dias do texto (ou trocar o campo por dias estruturados no painel). | médio | 🟡 |
| **P0** | 20 | Pós-procedimento nunca disparou — nenhuma mídia, nenhum feedback | **0** mensagens `postcare:` enviadas desde sempre; 3 bloqueios empilhados | Destravar na ordem: (a) `treatment_id` nulo em 19 de 20 consultas encerradas, (b) nenhuma consulta chega a `completed`, (c) `operationalStatus=paused` bloqueia todo outbound. | médio | 🟡 |
| **P1** | 21 | Problema relatado pelo paciente vira oferta de venda | *"Um dos dentes quebrou"* → lista de horários; *"meu dente quebrou e queria saber como faço"* → "é importante realizar uma avaliação" | ✅ **Feito:** trilho determinístico de relato de dano rodando sobre **qualquer** intent, com sinal de paciente recorrente (`findPastByLeadId`) e autodeclaração. Três ramos: paciente da casa → escala com data e tratamento da consulta; origem desconhecida → pergunta se o trabalho foi feito aqui; nunca cota, nunca oferta agenda. | médio | 🟡 |
| **P2** | 22 | Confirmação de agendamento não segue o template do operador | Comparado ao print enviado pelo Victor (21/07) | Conteúdo **já está configurado** (`depositConfirmationNotes`). Falta estrutura (Data/Horário em linhas rotuladas), campo de **complemento do endereço** (prédio/sala/andar) e unificar com o caminho sem sinal, hoje texto livre da LLM. | baixo | 🟢 |
| **P2** | 23 | Endereço vai como texto puro, sem link do Maps | `📍 Estamos na {address}.` — sem URL, sem pré-visualização | O operador manda link do Google Maps, que o WhatsApp renderiza com foto do prédio. Adicionar campo de URL do mapa e usá-lo nas respostas de endereço e na confirmação. | baixo | 🟢 |
| **P4** | 17 | Latência de 0–120s por dois saltos de cron | mediana 44s (Vitalli) / 15s (Ximendes); outlier de 539s | ⚠️ **Repriorizar:** a medição do #2 mostrou que o lag de registro (mediana 50s) é a causa raiz de 2/3 das aberturas indevidas. Não é só velocidade. | alto | 🔴 |

## Sábado (#18): a agenda já era consultada — a pergunta é que não chegava até ela

**O sábado nunca foi um caso especial do agendamento.** O `SlotEngine` trata sábado como qualquer
dia operado (inclusive com `saturdayEndHour` próprio), e `resolvePreferredDate("sabado")` já resolve
para o próximo sábado. Não faltava consulta à agenda: faltava a mensagem chegar ao caminho que
consulta.

Quem decide isso é `isBusinessHoursQuestion()`, que roteia entre dois destinos:

| Destino | Fonte da resposta | Quando |
|---|---|---|
| Institucional | string `businessHours` do cadastro | pergunta sobre expediente sem data |
| Agendamento | agenda real (appointments + bloqueios + GCal) | qualquer coisa com data explícita |

O desempate é `extractExplicitPreferredDateFromText`, cujo regex é `\bsabado\b` — **não casa com o
plural**. Daí duas respostas opostas para a mesma pergunta, medidas na Vitalli com um dia de
diferença:

| Data | Mensagem | Caminho | Resposta |
|---|---|---|---|
| 18/07 | "Sábado. Atende?" (singular) | agendamento | *"não temos horários disponíveis no sábado. Posso oferecer: 1. Seg 20/07 às 9h…"* |
| 19/07 | "Vocês atendem aos sábados?" (plural) | institucional | *"Sim, atendemos aos sábados. Horário cadastrado: Seg-Sáb 8h-18h."* |

A segunda é verdadeira e inútil: **sábado é o dia mais movimentado da Vitalli** — 17 agendamentos em
120 dias, mais que qualquer dia útil, das 08:30 às 17:30. Quem pergunta pelo sábado quer vir no
sábado. O operador responde *"Próximo horário disponível no sábado seria 01.08 às 8:00 tudo bem?"*.

**Correção:** o ramo institucional, ao detectar sábado numa clínica que abre sábado, chama o mesmo
`fetchAndOfferSlots` do caminho de agendamento e oferta os horários reais. Não muda o roteamento —
manter a pergunta como institucional preserva a resposta determinística (a LLM já foi flagrada
afirmando *"Temos horários disponíveis para sábado"* sem consultar nada, em 15/07).

**Restrito ao sábado de propósito** — ver #19: `parseBusinessHours` só sabe decidir esse dia.

## Confirmação numérica (#6): a lista de um item só

Diálogo real reconstruído do banco (Vitalli, 18/07, conversa `ff8fbb07`):

| Hora | Quem | Mensagem |
|---|---|---|
| 20:10 | agente | *"não temos horários no sábado. Posso oferecer: 1. Seg 20/07 às 9h … **5. Ter 28/07 às 16h**"* |
| 21:09 | lead | **"Dia 28/07 as 16h"** — escolheu pelo nome, não pelo número |
| 21:10 | agente | *"temos o seguinte horário disponível: **1.** Ter 28/07 às 16h. Por favor, responda apenas com o número da opção."* |
| 21:11 | lead | **"1"** |
| 21:12 | agente | *"Deixei o horário reservado provisoriamente…"* |

A oferta das 20:10 já havia vencido — TTL de 15 min e o lead voltou 59 minutos depois. Sem oferta
pendente, a mensagem virou busca nova, que devolveu **exatamente um** horário (o dele) e ainda assim
pediu um número.

**Não é falha de funil — é fricção.** O agendamento se completou. Mas o lead teve de traduzir a
própria escolha para o formato do sistema, e o atendimento passou a parecer formulário. O operador
escreve *"Próximo horário disponível no sábado seria 01.08 às 8:00 tudo bem?"*.

**Frequência: 1 em 19 ofertas numéricas** do corpus. Baixa hoje porque na maior parte do período a
IA esteve desligada e quem respondia data+hora era o operador — de 16 mensagens de lead com data e
hora, **15 não tiveram resposta da IA**. Tende a crescer conforme a IA assume.

### O que ficou de fora, de propósito

Agendar **sem confirmação** quando a frase é um comando explícito (*"Marca dia 22 às 16:00"*, *"Pode
ser dia 17.7 9:00"*) removeria um passo de verdade, não só a fricção. Não foi feito: o corpus
mistura comando com pergunta (*"Dia 16/07 as 9:00 tá disponível?"*, *"Dia 31 às 8:30 pode ser?"*), e
confundir os dois agenda alguém que só estava perguntando. Precisa de um guard de intenção
separado, com evidência própria.

## Preço + pagamento (#10): reauditado e já resolvido

A medição original ("9 de 34, 26%") lia o campo `intent` **gravado** nas mensagens — que reflete o
código do dia em que a mensagem foi processada, não o de hoje. Reauditando as frases reais contra o
código atual, **as 9 chegam a `price_inquiry`**:

| Frase real | `intent` gravado em produção | Hoje |
|---|---|---|
| *"Gostaria de saber valores e formas de pagamento"* | `price_inquiry` | ✅ |
| *"Esse valor pode ser parcelado ?"* | `needs_human` | ✅ via guard de pagamento |
| *"…lentes estratificadas na cor BL2. Gostaria de saber o valor aproximado"* | `acknowledgment` | ✅ via coerção de intent |
| *"sim, gostaria de saber o valor para colocar as lentes, se passar cartão"* | `price_inquiry` | ✅ |
| *"E quanto fica o valor parcelado?"* | `price_inquiry` | ✅ |

Nenhum código foi escrito. Foi adicionado teste de regressão em `BusinessIntentCoercion.test.ts`,
porque o caminho é uma **composição** de dois guards — coerção de intent e guard de pagamento no
orquestrador — e nenhum dos dois sozinho cobre todas as frases.

### Parcelamento escala para humano? Não — responde pela configuração

Fluxo atual de *"esse valor pode ser parcelado?"*:

1. O classificador pode devolver `needs_human` — e devolveu, no caso real de 19/07.
2. O orquestrador **sobrescreve de forma determinística**: pergunta simples de pagamento +
   `needs_human` → `price_inquiry`. Não é a LLM que decide isso.
3. A resposta sai da configuração da clínica — `commercialPolicy` + `installmentRates`, montados em
   `buildInstallmentTable`. Foi de lá que veio *"parcelado em até 21 vezes no cartão"*.

O que **continua** indo para o humano é negociação, pela lista de exclusão de
`isSimplePaymentPolicyQuestion`: *diferente, especial, desconto, negociar, condição especial, fora,
exceção, combinado, promoção, permuta, troca*. Ou seja:

| Mensagem | Quem responde |
|---|---|
| *"esse valor pode ser parcelado?"* | IA, pela config |
| *"em quantas vezes dá pra parcelar?"* | IA, pela config |
| *"tem como parcelar diferente?"* | humano |
| *"consegue um desconto especial?"* | humano |

O caso de 19/07 falhou porque o guard (`a772f57`) só chegou à `main` às **17:56 do mesmo dia** —
cerca de 16 h **depois** daquela mensagem. Não é bug vivo; é a evidência de que o guard é necessário.

**Nota de método:** este é o terceiro item do plano (depois de #4 e #7) cuja premissa não sobrevive à
verificação. `intent` gravado é histórico, não diagnóstico. Reauditar antes de codar.

## Abertura indevida (#2): o gargalo não é a semântica, é o lag de registro

`isFirstMessage` conta mensagens **não-lead**. Zero significa *"ninguém respondeu ainda"*, não *"é a
primeira mensagem do lead"*. Quem manda quatro mensagens sem ser atendido continua sendo primeiro
contato — um lead da Vitalli chegou a **14**.

| | |
|---|---|
| Primeiras respostas com o lead já em 2+ mensagens | **123** |
| Dessas, abriram com apresentação | **69 (56%)** |

**O que foi corrigido.** O campo acumulava dois papéis; agora são dois:

| Sinal | Governa | Regra |
|---|---|---|
| `isFirstMessage` | **apresentação** — saudação rica, nome da clínica uma vez | ninguém respondeu ainda |
| `isConversationOpening` | **abertura enlatada** — menu inicial / starter concierge | ninguém respondeu **e** o lead falou 1 vez só |

Quem nunca foi atendido merece a apresentação, seja na 1ª ou na 4ª mensagem. O que não pode é a
abertura **substituir** a resposta.

Somou-se um guard de rajada **pós-composição**. Já existiam três recheca de supersessão — pós-claim,
pós-debounce e pós-classificação — mas nenhuma cobria a chamada do composer (3–10 s). Restrito à
abertura de propósito: ali os ramos de resposta já rodaram, e descartar uma oferta de horário
deixaria slots reservados que o lead nunca viu.

### Por que o teto é ~33%

Medindo `created_at − sent_at` da 2ª mensagem nos 69 casos:

| | |
|---|---|
| Lag de registro (webhook → linha em `messages`) | mediana **50 s**, p90 **75 s**, máx **131 s** |
| 2ª mensagem **já registrada** quando a resposta foi gravada | **23 (33%)** |
| 2ª mensagem **ainda não registrada** | **46 (67%)** |

Em dois terços dos casos a segunda mensagem **não existia no banco** no momento da decisão. Nenhum
guard pode consultar o que não foi gravado, e nenhum ajuste de debounce alcança isso: o debounce
compara contra mensagens **registradas**, e a janela dele (15 s) é três vezes menor que o lag.

**Consequência de priorização:** o #17 (latência de 0–120 s por dois saltos de cron) deixou de ser só
um problema de velocidade. Ele é a **causa raiz de dois terços das aberturas indevidas** e do que
sobra das rajadas. Foi rebaixado a P4 por "melhora velocidade, não qualidade" — a medição desmente
isso.

## Casos trazidos pelo Victor (21/07) — verificação

Quatro anotações do cliente, conferidas uma a uma contra o código e o banco.

### #20 — Pós-procedimento: nenhuma mensagem jamais saiu

A observação do Victor foi *"o doutor não confirmou nenhum dos pacientes"*. É verdade, mas é só o
terceiro de **três bloqueios empilhados** — corrigir só esse não faria a mensagem sair.

A Vitalli tem as duas regras cadastradas e corretas:

| Regra | Offset | Mídias | Condição |
|---|---|---|---|
| Cuidados pós-lentes | 1h | **3** | por relógio (sem exigir status) |
| Pedido de feedback | 24h | 0 | exige `status = completed` |

| Bloqueio | Medição | Efeito |
|---|---|---|
| **1. `treatment_id` nulo** ✅ parcial | **19 de 20** consultas encerradas | As duas regras filtram por *Lentes em Resina Composta*. Sem tratamento na consulta, **zero** elegíveis. |
| **2. Nada vira `completed`** | 43 `scheduled`, 6 `cancelled`, 1 `confirmed`, **0 `completed`** | Mata a regra de 24h, que exige esse status. 16 consultas já encerradas seguem `scheduled`. |
| **3. `operationalStatus = paused`** | `autoReplyEnabled = false` | `shouldSendAutomatedClinicOutbound` barra **todo** outbound automatizado. |

Resultado: **0 mensagens `postcare:` na outbox desde que a feature existe.**

O bloqueio 1 é o mais silencioso: **44 das 50 consultas vêm do Google Calendar**, não do painel. O
importador até tentava casar tratamento, mas comparava o texto do evento com o **nome completo** do
tratamento — e a agenda real escreve *"Kevin Manutenção"*, não *"Manutenção Preventiva de lentes"*.
Nunca casava nada.

**Corrigido:** o importador passou a casar por nome **ou alias**, com desempate por especificidade —
o termo mais longo vence, e empate no topo não resolve. Cobertura medida nos 44 eventos reais:

| | Antes | Depois |
|---|---|---|
| Resolvido | **0** | **15** |
| Ambíguo (registrado em log) | — | 21 |
| Sem match | 44 | 8 |

Dos 15, onze são *Manutenção Preventiva de lentes* e apenas **dois** são *Lentes em Resina Composta* —
o tratamento que a regra de pós-lentes filtra.

**Os 21 ambíguos são todos da mesma forma: "N lentes".** A Vitalli tem três tratamentos de lente
(Composta, Premium, Estratificada) que compartilham o alias `lentes`, e o texto do evento não diz a
técnica. O sistema não inventa: isto grava prontuário, e escrever a técnica errada para fazer uma
automação disparar é pior do que não disparar.

Três saídas, todas do Victor:

1. **Escrever a técnica no evento** (*"20 lentes estratificada"*) — o matcher já resolve sozinho.
2. **Consolidar** os três tratamentos de lente em um, se o pós-operatório é o mesmo.
3. **Escolher no painel** quando a consulta for importada — exige UI.

Enquanto nenhuma for feita, o pós-lentes continua sem alcançar a maioria dos pacientes.

**Questão de produto no bloqueio 3:** cuidados pós-procedimento são instrução clínica, não marketing.
Faz sentido que a pausa comercial da IA também silencie orientação de cuidado? Provavelmente não —
mas é decisão do Victor, não nossa.

### #21 — Problema relatado vira oferta

Existe `isMaintenanceInquiryText` → `needs_human`, mas ele só roda dentro de `coerceBusinessIntent`,
que **retorna cedo** para qualquer intent que não seja `greeting`, `acknowledgment` ou `unclear`. Na
prática a LLM classifica essas mensagens como outra coisa e o guard nunca é consultado:

| Mensagem real | Intent | Resposta |
|---|---|---|
| *"Um dos dentes quebrou"* | `reject_slots` | ⚠️ lista de horários de segunda |
| *"o meu tende quebrou e queria saber como eu posso fazer"* | `general_question` | ⚠️ "é importante realizar uma avaliação clínica" |
| *"Como que seria a manutenção ?"* | `general_question` | ⚠️ vende manutenção preventiva |
| *"Na manutenção"* | `needs_human` | ✅ pede foto, escala |
| *"…ela quebrou ontem :( Queria refazê-la com vocês"* | `clinical_urgency` | ✅ escala |

Não é uniforme: quando cai em `needs_human`/`clinical_urgency` o comportamento é o que o Victor quer.
O problema é a rota depender da classificação da LLM.

**A segunda metade do pedido — "resgate de contexto" — não existe.** Não há nenhum sinal de paciente
já atendido em lugar nenhum do pipeline: nem `isReturningPatient`, nem histórico de consultas no
contexto do composer. Quem já fez lentes é tratado como lead novo de vendas. Conecta com o #9.

#### O caso Carla inteiro (Ximendes, 16/07) — o dado estava no banco

| Quando | O quê |
|---|---|
| 23/06 12:00 | Consulta `completed`, **Lentes de resina composta estratificada**, com `treatment_id` |
| 23/06 18:01 | Dr. Gregorie, à mão: *"Escova curaprox. Primeira manutenção com 3 meses, as demais 6 meses"* |
| 16/07 21:20 | Lead: *"Pode ser na segunda?"* + *"Um dos dentes quebrou"* — **4 segundos de intervalo** |
| 16/07 21:22 | IA (`reject_slots`): 5 horários de segunda |
| 16/07 21:23 | IA (`clinical_urgency`): *"vou acionar a equipe"* — resposta **separada**, 1 min depois |
| 16/07 21:24 | Lead responde "5" → IA agenda 20/07 14h |
| 16/07 21:44 | Operador desdiz: *"só vou ter horário amanhã ou dia 24"* |

Três falhas empilhadas — rajada partida (#15), relato virando venda (#21) e agenda ofertada que o
doutor não tinha. A que importa aqui: **o sistema tinha o histórico e não olhou**.

#### Medição das duas clínicas (5.606 mensagens de lead)

| | |
|---|---|
| Relatos de problema com trabalho existente | **22** (~19 reais; 3 eram pergunta sobre desgaste do procedimento) |
| Com consulta anterior registrada no sistema | **1** — a Carla |
| Leads com pelo menos uma consulta passada | 50 de 1.109 (4,5%) |

Daí a regra de desenho: **histórico é sinal positivo forte e sinal negativo nulo.** A Ximendes entrou
em 27/05 e a Vitalli em 09/07 — quem fez lentes há 9 meses não existe como consulta. Caso Mô (Vitalli,
14/07): *"troquei minhas lentes de resina com vcs lá na av Sabará tem aproximadamente 9 meses […] a
maioria das lentes estão quebrando"* — zero histórico, garantia pura, **autodeclarada no texto**. A IA
nunca pode dizer "não encontrei você aqui".

#### O trilho entregue

Três portas de entrada, uma para cada desfecho comercial:

| Porta | Como o sistema sabe | Resposta |
|---|---|---|
| Paciente da casa | consulta passada no banco (`findPastByLeadId`: `startsAt < agora`, não cancelada) | Acolhe citando a data da visita, pede foto, escala com *"consulta em 23/06 (Lentes estratificada) — verificar garantia"* |
| Autodeclarado | *"fiz com vocês"*, *"troquei com vcs"*, *"sou paciente"* | Igual, sem afirmar data ou tratamento que não temos |
| Origem desconhecida | nenhum dos dois | **Pergunta** se o trabalho foi feito aqui + pede foto. Não pausa a IA — pausar deixaria ela surda à resposta que ela mesma pediu |

Vale para as três: **nunca oferta horário, nunca cota, nunca envia mídia**. E a IA nunca afirma nem
nega garantia — não existe campo de garantia no cadastro, e a decisão é do dono da clínica.

Alcance medido no corpus: **8 mensagens em 5.606** (0,14%). Duas travas evitam sequestrar venda:
proximidade máxima de 40 caracteres entre o dano e o substantivo, e o substantivo **mais próximo**
vence — sem isso, *"só quero fazer as lentes, mas terei que remover 2 dentes quebrados"* (ST, 19/07) e
*"restaurações nesses dentes, alem de um quebrado […] as lentes resolvem isso?"* (Marta, 21/07) viravam
triagem de dano.

#### Achado paralelo: o preço da manutenção era da LLM

Eduardo (Ximendes, 16/07) — *"Manutenção e uma lente quebrada"* → IA: *"a manutenção normalmente sai
**a partir de R$ 100**"*. O catálogo da Ximendes diz **R$500** (Manutenção periódicas lentes) e
**R$200** (Conserto lentes); **R$100 é o preço da Avaliação**. O template de handoff mandava a LLM
*"informar o valor conforme configurado"* — preço na mão do modelo, contra a regra da casa. Agora o
valor sai resolvido do catálogo (`resolveMaintenancePriceLabel`) e, quando não existe cadastro, a
instrução é proibir qualquer número. A Vitalli tem os dois serviços cadastrados (Manutenção Preventiva
R$400, Substituição de lente R$200) — exatamente os valores que o operador respondeu à Amanda em 08/07.

### #22 — Template de confirmação

O conteúdo **já está configurado** — `depositConfirmationNotes` da Vitalli tem as três orientações
(10 minutos de antecedência, reagendamento com 24h, evitar acompanhante). O que difere do template do
operador:

| | Operador | Sistema |
|---|---|---|
| Data e horário | linhas rotuladas separadas | um `slotLabel` só |
| Prédio / sala / andar | *"Helbor Offices São Paulo Torre Sul, Sala 124 Andar 12"* | não existe campo; "Sala 124" está espremido dentro de `address` |
| Destaque | `⚠️ *EVITAR LEVAR ACOMPANHANTE*` em bloco próprio, negrito | item de lista igual aos outros |

Há ainda **dois caminhos de confirmação diferentes**: com sinal (Vitalli) usa o template
determinístico; sem sinal (Ximendes) é texto livre da LLM. Devem convergir.

### #23 — Endereço sem link do Maps

Hoje o endereço sai como `📍 Estamos na {address}.` — texto puro, em três pontos do orquestrador.
O operador manda o link do Google Maps, que o WhatsApp renderiza com foto do prédio. Não existe
campo de URL de mapa no cadastro.

## Rajadas: a IA responde mensagem a mensagem em vez de juntar o contexto

Relato do cliente confirmado em dados. Rajada = 2+ mensagens do lead em até 2 minutos:

| | |
|---|---|
| Rajadas no corpus | **763** |
| IA juntou o contexto (0–1 resposta) | 718 (**94%**) |
| **IA respondeu uma por uma** | **45 (6%)** |

Exemplos reais das que falharam:

- *"Tenho dois implantes e uma coroa eles contam"* + *"Como pode ser feito neste caso?"* → 2 respostas
- *"Qual a diferença da técnica"* + *"Eu não entendi nada"* → 2 respostas
- *"Olá bom dia"* + *"Tenho interesse em lentes de resina estratificada…"* → 2 respostas

### O caso de 13 segundos (Vitalli, 19/07 01:34) — a pergunta que sumiu

Encontrado ao reauditar #10. É a variante mais cara da rajada: a segunda pergunta **não recebe
resposta nenhuma**.

| Hora | Quem | Mensagem |
|---|---|---|
| 01:34:55 | lead | *"Esse valor pode ser parcelado ?"* |
| 01:35:08 | lead | *"Vocês atendem aos sábados ?"* ← **13 s depois** |
| 01:35:16 | agente | *"Sim, o investimento pode ser parcelado em até 21 vezes no cartão. Já avisei a equipe…"* |
| 01:39:11 | **operador** | *"SIm, atendemos aos sabados mediante disponibilidade, quer verificar as datas disponiveis inclusive semana?"* |

A IA respondeu só a primeira. A segunda foi respondida **pelo Victor, à mão, 4 minutos depois** —
de madrugada. Do ponto de vista da lead, a IA ignorou uma pergunta direta.

**O gap de 13 s cai exatamente na faixa que o #214 passou a cobrir.** O default de plataforma subiu
para 15 s, mas a Vitalli mantém um override explícito de **7000 ms** na coluna — é a única clínica
que ainda não herda o default. Com 15 s, as duas mensagens teriam sido fundidas e respondidas juntas.

**Ação pendente:** limpar `message_debounce_ms` da Vitalli para `null`. É só dado, reversível, e
fecha o item #15.

**É o mesmo fenômeno dos 8 openers indevidos** (E1 do mapa): a rajada dispara pela primeira
mensagem e a resposta sai depois da segunda já ter chegado. Num caso o sintoma é "respondeu duas
vezes"; no outro, "respondeu com a saudação em vez do conteúdo". O terceiro exemplo acima é
literalmente um dos 8.

### O que já existe

| Mecanismo | Onde | Estado |
|---|---|---|
| `messageDebounceMs` — janela de agrupamento antes de processar | config por clínica, com default de plataforma | Vitalli 7000ms; Ximendes usa o default |
| `rapidThrottleMs` | config por clínica | 4000ms nas duas |
| Guard de rajada pós-classificação — relê a última mensagem do lead e descarta a resposta se foi superada | `ConversationOrchestrator:4416` | ativo, mas só quando `!skipLlm` |

**Correção de uma leitura inicial:** cheguei a registrar que a Ximendes estava "sem agrupamento".
**Falso** — `messageDebounceMs` é nulo na coluna, mas o código sempre aplicou um fallback. O problema
nunca foi ausência do mecanismo, e sim o **valor**: o fallback era de 5s contra um gap mediano de 10s
dentro da rajada, cobrindo só ~35% dos pares.

O default virou constante única (`DEFAULT_MESSAGE_DEBOUNCE_MS`) em 15s — cobertura de ~67%. A escolha
de mantê-lo global, e não por clínica, vem do dado: o gap mediano é 10s **nas duas clínicas**, com
distribuições quase idênticas. É comportamento do canal, não política de clínica.

### O que ainda não sei

Os 8 openers indevidos **deveriam** ter sido pegos pelo guard: `isolatedGreeting` exige
`!isFirstMessage`, logo em primeiro contato `skipLlm = false` e o guard roda. Não determinei por que
escapam.

Hipótese **não verificada**: a segunda mensagem chega depois da releitura do guard mas antes do
envio — janela entre classificação e composição.

**Não corrigir por palpite.** O caminho é instrumentar o guard (registrar quando descarta e quando
deixa passar) e re-medir depois de alguns dias com o #211 em produção.

## Latência de resposta: 0–120s vêm da arquitetura de filas, não do debounce

Percepção do cliente: *"a Ximendes demora 1 a 2 minutos"*. Os dados **contradizem a comparação
entre clínicas**, mas **confirmam a faixa**.

| Clínica | mediana | p75 | p90 | máx | >60s |
|---|---|---|---|---|---|
| Vitalli | **44s** | 63s | 74s | 115s | **28%** |
| Ximendes | **15s** | 39s | 58s | **539s** | 9% |
| Ximendes (testes internos) | 12s | 15s | 30s | 73s | 3% |

A Ximendes é ~3x **mais rápida** na mediana. A percepção inversa provavelmente vem dos outliers
(máximo de 539s = 9 min) ou de comportamento posterior a 20/07, fora deste recorte.

### A causa é estrutural

Não existe caminho de disparo imediato — toda mensagem passa por **dois saltos de cron**:

```
webhook → ENFILEIRA (não processa inline)
   ↓  message-worker  · cron a cada minuto · MAX_JOBS_PER_RUN = 3
   ↓  outbox
   ↓  sender-worker   · cron a cada minuto · MAX_JOBS_PER_RUN = 5
enviado
```

**Latência de base: 0–120s** — exatamente a faixa relatada.

**Não confundir com o debounce.** O `messageDebounceMs` opera em 7–15 **segundos**; o ciclo de crons,
em até 120. O debounce responde por ~5–10% do atraso — e, coerente com isso, a clínica que **tem**
debounce (Vitalli, 7s) é a mais lenta, não a mais rápida.

**Risco de escala:** 3 mensagens processadas/min e 5 enviadas/min. Com ~250 leads/dia na Vitalli a
média cabe, mas um pico concentrado forma fila — provável origem do outlier de 9 minutos.

### Decisão: deixado por último, de propósito

Corrigir exige mexer na infraestrutura de processamento (disparo imediato pós-webhook) — mais
arriscado que qualquer item de conversa acima, e **não melhora a qualidade da resposta, só a
velocidade**. A prioridade é acertar *o que* a IA responde antes de acelerar a entrega.

## Por que esta ordem

- **P0 #1 é o melhor retorno do plano**: uma mudança de configuração corrige o mecanismo que
  provoca a maior parte das aberturas indevidas. Sem deploy, reversível na hora.
- **#1, #2 e #9 atacam a mesma raiz** (perda de contexto) por caminhos diferentes — juntos cobrem
  E1, E3 e boa parte de E6.
- **#4, #5, #7 são guards determinísticos**: não tocam prompt, então não regridem o tom ajustado
  nas waves 3/4/5. Casam com a regra do `AGENTS.md` — *o sistema decide, a LLM verbaliza*.
- **#3 é o maior valor absoluto** mas exige decisão de produto (cadência, opt-out, limites do
  Channel Safety), por isso não é o primeiro a executar apesar do P0.

## O que NÃO mexer

Quando o intent é reconhecido, o agendamento funciona: *"Terça dia 23 as 15h20"* → confirmação
correta com endereço; *"Dia 03/07"* → horários daquela data; *"Sábado. Atende?"* → informa que
aquele sábado está sem vaga **e oferece alternativas**. Nenhuma correção acima deve alterar esse
caminho — #18 justamente trouxe o plural para dentro dele em vez de duplicá-lo.

## Ressalvas

- Duas clínicas do mesmo segmento e público. Não generaliza para premium/luxo.
- M3 (truncamento pós-reset) foi identificado no código mas **não quantificado** — não sei quantos
  dos 28 openers restantes vêm dele. Investigar antes de mexer.
- Volumes pequenos (#6, #14) são sinal de padrão, não estatística.
- Nenhuma correção acima é verificável hoje: a atribuição de conversão (PR #210) começou a medir
  em 21/07 e ainda não tem linha de base.
