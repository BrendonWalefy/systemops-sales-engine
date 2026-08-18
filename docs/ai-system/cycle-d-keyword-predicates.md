# Ciclo D — a camada de keyword, medida

Fecha o Ciclo D do plano canônico
([`docs/superpowers/plans/2026-08-15-conversation-intelligence-v2.md`](../superpowers/plans/2026-08-15-conversation-intelligence-v2.md)).

O objetivo do ciclo é uma coisa só: **descobrir com dado quais predicados de palavra-chave são
feature e quais são cicatriz, sem remover nenhum**. Medir antes de remover — inverter essa ordem
foi o que criou a camada.

**Nenhum predicado foi removido. Nenhum comportamento mudou.** A suíte inteira (302 arquivos,
2.736 testes) passa antes e depois.

---

## 1. Primeiro achado: a camada é maior do que a auditoria estimou

A auditoria registrou **30 predicados**. Aplicada uma régua explícita e uma varredura
reproduzível, o inventário fechou em **38**.

| Fonte | Predicados |
|---|---:|
| `ConversationOrchestrator.ts` | 30 |
| `conversation-response-parts.ts` (reexportado pelo orquestrador) | 8 |
| **Total** | **38** |

Os 30 do orquestrador batem com a estimativa da auditoria. Os 8 restantes vivem no módulo irmão
que o orquestrador importa **e reexporta** — são a mesma camada, e ficaram fora da contagem
original porque a auditoria olhou um arquivo.

Dois deles não estavam em lista nenhuma e foram **descobertos pela varredura**:
`agentMessageEndsWithCta` e `leadEngagesWithCta`. Nenhum documento do programa os citava.

> Isto é, por si, um resultado do ciclo: a camada não era conhecida. Uma estimativa por amostra de
> exemplos subcontou em 27%.

### Como o inventário não deriva mais

`KEYWORD_PREDICATE_REGISTRY` é o inventário, e `KeywordPredicateRegistry.test.ts` o trava:

- toda função booleana que casa texto nos dois módulos precisa estar registrada ou isentada com
  motivo escrito — senão o teste falha;
- predicado registrado que sumiu do código falha o teste;
- classificação sem evidência escrita (≥ 20 caracteres) falha o teste;
- predicado marcado `readsOpenLanguage` classificado como `feature` falha o teste — a régua não
  pode ser contrariada em silêncio.

O próximo `if` de keyword que alguém adicionar quebra o build até ser inventariado.

---

## 2. A régua

Do plano canônico, sem reinterpretação:

- **feature** — lê **entrada estruturada**: escolha por número, comando, rótulo exato de menu.
  Deve continuar código; um classificador não faria melhor.
- **cicatriz** — **reclassifica linguagem natural aberta** ("isto é pergunta de horário?"). É o
  trabalho do classificador, e é onde regex perde.

Resultado: **3 feature, 35 cicatriz**.

---

## 3. Como a medição foi feita

### O classificador não é chamado — de propósito

O D0 mediu que o classificador oscila com a mesma entrada e `temperature: 0`. Se este relatório
chamasse o modelo, creditaria a predicados divergências que são churn — exatamente o que a
pré-condição do Ciclo D proíbe.

A referência é o **rótulo do corpus**, traduzido para o vocabulário da V1 por `expectedV1Intent`.
Determinístico, roda em CI, custo zero, mesma régua do baseline.

### Os 5 casos instáveis saem do primário

Os cinco que o D0 mediu como instáveis (`burst-0003`, `discount-0001`, `first-contact-0003`,
`objection-0005`, `price-0003`) são **excluídos da contagem principal** e reportados em coluna
própria (`instv`). Nenhum predicado é creditado nem penalizado por eles.

**Medição sobre 61 casos estáveis, de 66.**

### O que "disparo" mede, e o que não mede

O predicado roda **isoladamente** sobre a mensagem do caso. Isso mede **poder discriminativo**,
não frequência em produção. Por isso cada entrada carrega `runtimeGate`:

| Gate | Significado |
|---|---|
| `ungated` | roda sobre o texto de qualquer turno que chegue ao ramo |
| `intent-gated` | só é consultado depois de o classificador dizer algo (ex.: dentro de `coerceBusinessIntent`, que exige greeting/acknowledgment/unclear) |
| `state-gated` | só é consultado num estado de conversa específico |

Sem essa coluna o relatório confundiria erro isolado com dano em produção.

---

## 4. O resultado medido

`npm run report:predicates` → [`evals/corpus/predicate-overrides.json`](../../evals/corpus/predicate-overrides.json)

```
predicado                               cls      gate           disp  acerta  erra  instv
-----------------------------------------------------------------------------------------
isSchedulingRequestText                 cicatriz ungated           6       1     5      0
detectAppointmentConfirmation           cicatriz state-gated       6       1     5      1
isMaintenanceInquiryText                cicatriz intent-gated      3       0     3      0
isPriceRequestText                      cicatriz intent-gated     13      11     2      2
isDirectAddressQuestion                 cicatriz state-gated       4       3     1      0
isSimplePaymentPolicyQuestion           cicatriz ungated           1       0     1      1
isSaturdayQuestionForOperatingClinic    cicatriz ungated           1       0     1      0
isBusinessHoursQuestion                 cicatriz ungated           1       1     0      0
isShortAffirmativeReply                 cicatriz ungated           1       0     0      0
isEvaluationPriceRequest                cicatriz ungated           1       1     0      0
… (10 predicados sondados com 0 disparos)
```

Dano total por gate: **ungated 7 · intent-gated 5 · state-gated 6**.

### As quatro cicatrizes que o corpus provou

**`isSchedulingRequestText` — 5 erros em 6 disparos, e é `ungated`.** O pior do inventário.

| caso | mensagem | rótulo do corpus | o predicado impõe |
|---|---|---|---|
| `availability-0002` | "Teria alguma horário pra quinta?" | `check-availability` | `book_appointment` |
| `availability-0003` | "Na terça tem algum horário?" | `check-availability` | `book_appointment` |
| `availability-0004` | "Vc tem horário pra sexta feira ou sábado?" | `check-availability` | `book_appointment` |
| `reschedule-0001` | "…vou tentar **remarcar** um compromisso" | `defer-answer` | `book_appointment` |
| `scheduling-0002` | "vou usar a pasta de dente parodontax…" | `clinical-advice` | `book_appointment` |

Dois defeitos distintos, ambos previstos pela leitura do código e **confirmados pelo dado**:
a palavra `horario` colapsa *consultar disponibilidade* em *agendar* — uma distinção que o corpus
faz e a lista não alcança; e `remarcar` casa por substring quando o lead fala de um compromisso
**dele**, não da clínica.

**`isMaintenanceInquiryText` — 3 erros em 3 disparos (100%).** O mais claro do inventário:
`scheduling-0001` ("queria marcar a manutenção das lentes", rótulo `book-appointment`) é
empurrado para `needs_human` — a palavra "manutenção" bloqueia um agendamento que o lead pediu
explicitamente.

**`isSaturdayQuestionForOperatingClinic` — 1 erro em 1 disparo.** `availability-0004` ("horário
pra sexta feira ou sábado?", rótulo `check-availability`) vira pergunta institucional de
expediente. É a família documentada na memória do projeto como `"Segunda"` → falso indisponível:
a resposta ao bug foi criar o predicado do sábado em vez de corrigir o eixo de disponibilidade.

**`isPriceRequestText` — 13 disparos, 11 corretos (85%), mas erra onde importa.**
`procedure-0002` ("O procedimento demora quanto tempo?", rótulo `procedure-duration`) vira
`price_inquiry` pela palavra `quanto`. Um lead perguntando duração recebe preço.

### O caso que precisa de ressalva: `detectAppointmentConfirmation`

Erra 5 de 6 na sonda isolada — "Vou ver se consigo fazer a sombrancelha mês que vem" (rótulo
`postpone`) é lido como **confirmação de presença**, porque `vou` é token de "sim".

**Mas o predicado é `state-gated`:** em produção só roda quando
`state === "awaiting_appointment_confirmation"`, e nenhum dos 5 casos está nesse estado. O erro
medido é **poder discriminativo ruim**, não dano em produção observado. Registrar como dano seria
inflar o resultado — e o guard de estado é justamente o que segura a imprecisão.

Vale o mesmo para `isDirectAddressQuestion` (1 erro, `state-gated`): em `price-0004` a mensagem é
"Valores e endereço" — um pedido **composto** que o rótulo único do corpus resolve como
`price-of-service`. É limitação de rótulo único, não erro do predicado.

---

## 5. Limite honesto do instrumento: 18 de 38 não são sondáveis pelo corpus

Quase metade do inventário não pode ser medida com o corpus atual, e o relatório os declara em vez
de silenciá-los:

| Motivo | Predicados |
|---|---|
| Entrada estruturada — o corpus é de linguagem natural e não tem turno de menu numerado | `isResetCommand`, `resolveMenuSelection`, `isMenuRerequest` |
| Lêem texto do próprio agente em posição que o corpus não reconstrói | `messageOffersConcreteSlot`, `didAgentAskForProcedure`, `agentMessageEndsWithCta`, `leadEngagesWithCta` |
| Agregador, medido pelos predicados que encadeia | `coerceBusinessIntent` |
| Dependem de estado de oferta pendente que o corpus não carrega | `normalizeSchedulingIntentForMissingPendingOffer` |
| Exigem catálogo do tenant carregado | `detectUncataloguedMaintenanceInquiry`, `isQuantityFollowupToPriceQuestion` |
| Wrappers de predicados já sondados, com a mesma decisão | `isLocationRequest`, `isLocationRequestText`, `isProcedureCatalogRequestText`, `isUrgencyRequestText`, `isHumanRequestText`, `isPeriodPreferenceText`, `isIsolatedGreeting` |

Para esses 18, a classificação repousa em **evidência de código** — listas de palavras, remendos
documentados em comentário, bugs de produção citados no próprio arquivo — e não em contagem sobre
o corpus. Cada um carrega essa evidência escrita no registro.

**Isto é uma dívida do corpus, não do ciclo.** Fechar as duas primeiras linhas da tabela exige
casos de menu numerado e de turno-do-agente, que o corpus hoje não tem.

---

## 6. Surpresas e ambiguidades

1. **A camada é 27% maior que a estimativa** (38 × 30), e dois predicados eram desconhecidos.

2. **O exemplo do plano para o teste do Ciclo D não roda.** O plano pede: "dado um turno onde
   `isBusinessHoursQuestion` dispara e o classificador havia dito `general_question`, o trace
   registra `divergedFromClassifier: true`". Isso é impossível no código real:
   `coerceBusinessIntent` retorna cedo para qualquer intent que não seja
   greeting/acknowledgment/unclear, então com `general_question` o predicado **nunca é
   consultado** — e se fosse, imporia `general_question`, que não é divergência. O teste foi
   escrito sobre a divergência real (classificador diz `greeting`, predicado impõe
   `general_question`), que é o bug "como funciona" + "bom dia" já documentado na memória do
   projeto.

3. **Três predicados cobrem o mesmo eixo de localização** com precisões diferentes
   (`isLocationRequestText`, `isLocationRequest`, `isDirectAddressQuestion`) — e o comentário do
   código admite que o terceiro existe porque o primeiro é impreciso demais.

4. **`isPriceRequestText` é cicatriz e é load-bearing.** 13 disparos, 85% corretos, o maior volume
   do inventário. A régua o classifica como cicatriz porque reclassifica linguagem aberta — mas
   removê-lo sem substituto **derruba** 11 acertos. Para o Ciclo J: a régua classifica *tipo*, não
   autoriza remoção; remoção exige capability equivalente medida.

5. **O rótulo único do corpus não representa mensagem composta.** "Valores e endereço" tem um
   rótulo só. Não é defeito de predicado nem do corpus — é limite da taxonomia, e o Understanding
   da V2 (que prevê `request` + `entities`) é onde isso se resolve.

6. **`unstableAcrossRuns` do D0 tem 5 casos; o corpus tem 66 e o D0 guardou saída de classificador
   para 22.** A coluna `divergesFromStoredClassifier` cobre só esses 22 e não foi usada como
   evidência principal por isso.

---

## 7. Gates do ciclo

| Gate (do plano) | Resultado |
|---|---|
| Relatório produzido sobre o corpus inteiro | ✅ 66 casos carregados, 61 estáveis medidos, 5 instáveis segregados |
| Cada predicado classificado feature ou cicatriz | ✅ 38 de 38 — 3 feature, 35 cicatriz |
| Evidência por decisão | ✅ travada por teste; 20 com evidência medida, 18 com evidência de código declarada |
| Nenhum predicado removido | ✅ nenhum |
| Instrumentação aditiva, sem efeito de comportamento | ✅ suíte completa verde antes e depois |
| `npm run verify` | ✅ verde |

### Rollback

Três arquivos novos (`KeywordPredicateEvaluation.ts`, `KeywordPredicateRegistry.ts`,
`report-predicate-overrides.ts`), dois estendidos de forma aditiva (`DecisionTrace.ts` ganha um
estágio e uma allowlist; `ConversationOrchestrator.ts` ganha um callback opcional). Reverter é um
commit. Nenhuma mudança de schema, nenhuma migração, nenhum caminho de produção alterado.

---

## 8. O que o Ciclo D entrega ao Ciclo E, e o que ele não decide

**Entrega.** O Ciclo E precisa saber quais regras o core V2 tem de reproduzir e quais existem só
para compensar a falta de contexto. As 35 cicatrizes dizem o segundo; as 3 features dizem o
primeiro. `NextStep`/`repeatPolicy` do contrato do E responde diretamente a
`didAgentAskForProcedure`, `didAgentAskToShowAvailability` e `agentMessageEndsWithCta` — os quatro
predicados que releem a prosa da própria IA porque a decisão não foi registrada.

**Não decide.** Nada sobre remoção. A remoção é do Ciclo J, condicionada a capability equivalente
medida — e `isPriceRequestText` é a prova de que "cicatriz" não é sinônimo de "descartável".
