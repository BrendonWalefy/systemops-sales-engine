# Relatório da primeira baseline do classificador de intenção

Data da medição: 2026-08-13
Modelo: `gpt-4o-mini` (default de `OPENAI_CLASSIFIER_MODEL`)
Rodadas: 3
Erros de execução: 0
Comando: `npm run eval:intent -- --repeat 3 --write-baseline`

Este é o primeiro número de acurácia do `IntentClassifier` na história do projeto. Até aqui
a suíte inteira rodava com o LLM stubado e o CI não tinha chave de LLM alguma, então nenhuma
mudança de prompt ou de modelo jamais foi medida.

## 1. Resultado

| Estrato | Casos | Acurácia | Amplitude | Crítica | Alta | Média | Baixa |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A — incidentes reais | 21 | **73,0%** (15,3/21) | 4,8 pp | 6 | 9 | 0 | 2 |
| B — aderência às regras do prompt | 58 | **92,5%** (53,7/58) | 1,7 pp | 1 | 3 | 9 | 0 |

Contagens de severidade são o total das 3 rodadas; divida por 3 para ler por rodada.

Os estratos não somam e não devem ser comparados como se medissem a mesma coisa. O estrato A
mede generalização em texto real de lead. O estrato B mede se o modelo obedece frases que a
própria instrução dele nomeia — é o piso, não o teto.

## 2. O achado principal: 10 dos 16 guards são candidatos a retirada

Dos 21 casos do estrato A, 16 têm `observedLlmIntent` diferente do rótulo correto, isto é,
foram falhas reais de produção que motivaram a escrita de um guard determinístico no
orquestrador. Cruzando com o que o modelo erra hoje:

**Ainda erra — guard indispensável (6 casos):**

| Rótulo | Mensagem |
| --- | --- |
| `patient_arrived` | "Oi, bom dia, tudo bem? Eu estou aqui na frente mas ninguém atende." |
| `patient_arrived` | "estou aqui na frente mas ninguém atende" |
| `patient_arrived` | "cheguei" |
| `needs_human` | "Quanto custa manutenção?" |
| `needs_human` | "Quanto é o reparo?" |
| `needs_human` | "Qual o preço do polimento?" |

**Agora acerta — guard candidato a retirada (10 casos):**

| Rótulo | Mensagem |
| --- | --- |
| `price_inquiry` | "Olá! Posso ter mais informações sobre custo ?" (caso Tania) |
| `price_inquiry` | "Olá boa tarde!! E qual seria os valores?" (caso Julllys) |
| `price_inquiry` | "Olá! Posso ter mais informações sobre custo?" |
| `price_inquiry` | "E qual seria os valores?" |
| `price_inquiry` | "Quanto custa uma lente?" |
| `general_question` | "clareamento" |
| `general_question` | "Vocês atendem aos sábados?" |
| `general_question` | "Qual seu horário de atendimento?" |
| `book_appointment` | "quero agendar uma consulta" |
| `book_appointment` | "Posso agendar um horário?" |

Leitura prática: a coerção de **preço**, de **pergunta geral** e de **agendamento** engolidos
por saudação deixou de ser necessária — o modelo resolve nativamente. Já os guards de
**chegada do paciente** e de **manutenção fora de catálogo** seguem sendo o que sustenta o
produto, e retirá-los reintroduziria falha de severidade crítica e alta.

Isso alimenta diretamente a spec de retirada de guards da §13 da spec de design. E reforça a
inversão defendida ali: não se extrai seam de código que deveria ser deletado.

## 3. Confusões medidas

**Estrato A** (total das 3 rodadas):

```
needs_human      <- price_inquiry      6x
needs_human      <- general_question   3x
patient_arrived  <- acknowledgment     3x
patient_arrived  <- greeting           3x
acknowledgment   <- greeting           2x
```

As três primeiras linhas são os casos de manutenção: o modelo trata "quanto custa
manutenção?" como uma pergunta de preço comum, exatamente o comportamento que a regra de
manutenção do prompt tenta impedir. As duas linhas de `patient_arrived` são o caso Carla e
suas variações — presença física lida como cortesia.

`acknowledgment <- greeting` é o caso `cheguei` com `isClinicSegment: false`, e é falha de
severidade baixa: fora do segmento de saúde a chegada não tem tratamento próprio.

**Estrato B** (total das 3 rodadas):

```
reschedule_appointment <- greeting           4x
needs_human            <- general_question   3x
price_inquiry          <- general_question   3x
reschedule_appointment <- general_question   2x
patient_arrived        <- unclear            1x
```

Dois achados aqui merecem destaque.

**`price_inquiry <- general_question` 3x.** As frases desse caso são `"quanto custa"`,
`"qual o valor"` e `"tem plano"` — literalmente as três que a regra do prompt cita como
`price_inquiry`. O modelo lê parte delas como pergunta geral. É a evidência direta de que as
regras estão se degradando entre si: uma instrução explícita, citada textualmente, não está
valendo.

**`reschedule_appointment` falha 6x das 6 possíveis.** Nenhuma das duas frases de remarcação
foi classificada certo em rodada alguma. Isso confirma por medição a hipótese levantada na
curadoria: o prompt **não tem nenhuma frase citada** para `cancel_appointment`,
`reschedule_appointment` nem `unclear` — só o comentário do `IntentType`. Dois intents de
agenda sem uma linha de orientação escrita, e o resultado aparece na medição.

## 4. Variância e o limiar do gate

A amplitude entre a melhor e a pior rodada, com `temperature: 0`:

- Estrato A: **4,8 pp** (equivale a um caso virando, já que 1/21 = 4,8 pp)
- Estrato B: **1,7 pp** (um caso em 58)

Confirma o que a spec previu: `temperature: 0` não garante determinismo na OpenAI. Qualquer
limiar de acurácia mais apertado que ~5 pp no estrato A vai flakear.

**Descoberta sobre o gate, encontrada ao prová-lo.** O gate compara falha por rodada. Uma
falha rara — uma ocorrência em 3 rodadas, isto é 0,33 por rodada — aparecendo uma vez numa
checagem de 1 rodada lê como 1,00 por rodada, e reprova sem que nada tenha piorado. Foi
exatamente o que aconteceu no teste de corrupção: além da regressão plantada, o gate acusou
`prompt_rule: falha critical subiu de 0,33 para 1,00`, que era só variância.

Recomendação para a etapa 2 do gate, derivada da medição e não escolhida a gosto:

1. A checagem precisa rodar com o **mesmo `--repeat` da baseline** (3), nunca 1 contra 3.
2. Falha de nível bloqueante só reprova quando o aumento excede **1 ocorrência por rodada**,
   que é a granularidade do ruído observado.
3. Acurácia plana permanece informativa e nunca reprova, como já está.

Sem esses dois primeiros ajustes, promover o gate a CI trava PR por ruído.

## 5. Experimento de interferência: hipótese NÃO sustentada

A spec de design (§11) levantou que `classify()` faz cinco trabalhos numa chamada — intent,
resolução de tratamento, extração de horário, ambiguidade e clarificação — e que as ~20 linhas
de regra de tratamento competiriam com as ~100 de regra de intent, degradando a acurácia. O
experimento: rodar o mesmo dataset com e sem a lista de tratamentos no prompt.

| Estrato | Com tratamentos | Sem tratamentos | Delta |
| --- | --- | --- | --- |
| A — incidentes | 73,0% (amp 4,8 pp) | 76,2% (amp 0,0 pp) | +3,2 pp |
| B — regras | 92,5% (amp 1,7 pp) | 93,1% (amp 3,4 pp) | +0,6 pp |

Severidade no estrato A, nas duas condições: **crítica 6, alta 9 — idênticas.**

**A hipótese não se sustenta nesta medição.** Três razões:

1. O delta de +3,2 pp é **menor que a amplitude** da condição com tratamentos (4,8 pp). O
   efeito cabe inteiro dentro do ruído do próprio experimento.
2. Os níveis bloqueantes não mudaram em nada. A única diferença no estrato A foi o
   desaparecimento das 2 falhas de severidade baixa, isto é **um caso** (`cheguei` com
   `isClinicSegment: false`).
3. A lista de tratamentos mudou **qual** resposta errada o modelo dá, não **se** ele erra:
   sem ela, `patient_arrived <- acknowledgment` (3x) virou `patient_arrived <- greeting` (6x),
   com a contagem de crítica intacta em 6.

**O que isso não significa.** Não é prova de que interferência não existe. Com 21 casos, um
caso vale 4,8 pp, então este experimento é incapaz de detectar efeito menor que ~5 pp. Ele
**falhou em detectar**, que é diferente de **refutar**.

**Consequência para a spec de separação de responsabilidades** (§13, item 1 da spec de
design): ela perde a evidência que este experimento deveria fornecer. Separar o classificador
segue defensável por argumento de manutenibilidade — cinco responsabilidades numa função é
custo real de leitura e de edição — mas **não** por ganho de acurácia demonstrado. Antes de
investir nela, crescer o estrato A com histórico sanitizado é o passo que torna a pergunta
respondível.

## 6. O gate foi provado, não presumido

Um caso foi deliberadamente corrompido (`p01-ola`, rótulo trocado de `greeting` para
`price_inquiry`) e o runner saiu com código 1, citando `incident: falha high subiu de 3,00
para 4,00 por rodada`. O caso foi restaurado com `git checkout`.

Nota de defeito do plano, encontrada aqui: a corrupção originalmente planejada (trocar
`price_inquiry` por `greeting`) **não** teria reprovado, porque o par resultante
`(greeting, price_inquiry)` não está catalogado na matriz de severidade e cai no default
`medium`, que não é bloqueante. A corrupção precisa produzir um par catalogado como Crítica
ou Alta para exercitar o gate.

## 7. Limitações do runner, encontradas ao usá-lo

Nenhuma impede o uso; todas valem como melhoria futura.

- **Sem concorrência.** As chamadas são sequenciais, então 79 casos × 3 rodadas levam
  vários minutos e duas condições em sequência estouram 10 minutos. Paralelizar com um
  limite pequeno de concorrência resolveria, respeitando rate limit.
- **Sem saída por caso.** O relatório agrega em confusões, então identificar *qual* caso
  falhou exige inferir pelo par (esperado, obtido). Um modo `--per-case` tornaria a análise
  de retirada de guard direta em vez de inferida.
- **Custo real não é observável.** `classify()` descarta o `usage` da resposta, e ler isso
  exigiria alterar produção. O custo se confere no billing da OpenAI.

## 8. O que este relatório não diz

- Não diz que o classificador está bom ou ruim em conversa real. 21 casos do estrato A são
  falhas conhecidas, não a distribuição de leads de verdade.
- Não diz nada sobre tom, acolhimento ou condução de funil. O harness mede correção de
  intent e só isso.
- Não autoriza retirar guard algum. Ele identifica **candidatos** com evidência; a retirada
  é spec própria, com seus próprios testes.
