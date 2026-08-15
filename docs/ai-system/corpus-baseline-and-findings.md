# Baseline da V1 e descobertas do corpus

Data: 2026-08-15
Ciclo: C do [plano da Conversation Intelligence V2](../superpowers/plans/2026-08-15-conversation-intelligence-v2.md)
Artefato de medição: [`evals/corpus/baseline-v1.json`](../../evals/corpus/baseline-v1.json)

Este documento tem duas partes. A primeira é o **baseline**: o que a V1 marca no
corpus, e sob quais condições. A segunda são as **descobertas** — o que o corpus
mostrou sobre a arquitetura proposta para a V2, incluindo onde ele contrariou o
que tínhamos escrito.

Nada aqui foi corrigido depois de medido. Bug encontrado virou caso, não patch.

---

## Parte 1 — Baseline da V1

### Condições da medição

| Item | Valor |
| --- | --- |
| Casos | 66 (41 históricos, 13 da demo curada, 12 regressões sintéticas) |
| Modelo do classificador | `gpt-5.4-mini` — o de produção |
| Chamadas | 64 (2 casos são turnos iniciados pela clínica, sem mensagem de lead) |
| Latência média por chamada | 1,26 s |
| Tempo total da rodada | 90 s |

**Ressalva de rodada única.** O número de Understanding varia entre execuções:
duas rodadas com `gpt-5.4-mini` deram **70,3%** e **71,9%**. O baseline registra a
segunda. Comparações V1 × V2 precisam de repetição, como o eval de intenção já faz
com `--repeat 3`.

**Ressalva do primeiro erro.** A primeira execução mediu `gpt-4o-mini`, o default
de 2024, porque `OPENAI_CLASSIFIER_MODEL` vive nas variáveis de Production da
Vercel e não no `.env.local`. Foi descartada. Fica registrado porque qualquer
pessoa que rodar o eval sem a variável vai medir o modelo errado e não vai
perceber.

### Camada 1 — Understanding

Reportado **por eixo**, como o ciclo exige:

| Eixo | Casos que esperam o eixo | Produzidos pela V1 | Acurácia |
| --- | ---: | ---: | ---: |
| `request` | 66 | 64 | **71,9%** |
| `dialogueMove` | 66 | 0 | — |
| `entities.service` | 35 | 0 | — |
| `entities.date` | 10 | 0 | — |
| `signals.objection` | 11 | 0 | — |
| `safety.requestsHuman` | 3 | 0 | — |
| `ambiguity` | 6 | 0 | — |

A V1 produz **um** eixo. Os outros seis não têm produtor nenhum — não é limitação
do instrumento, é o retrato. E é a razão de a V1 precisar dos overrides: sem eixo
de movimento de diálogo, `confirm_slot` e `reject_slots` têm de ser corrigidos
depois da classificação, com código, contra o estado.

**71,9% aqui contra 95,2% no eval de intenção não é contradição — é o ponto.**
O eval de intenção tem 58 dos 79 casos no estrato `prompt_rule`: frases que o
próprio system prompt nomeia. O corpus é turno real. Na régua real, o mesmo
classificador acerta cerca de sete em dez.

As 18 confusões, agrupadas:

| Confusão | Ocorrências | O que revela |
| --- | ---: | --- |
| `confirm_slot` → `acknowledgment` | 2 | "Pode confirmar", "Consigo sim" viram ruído. É o eixo de movimento de diálogo faltando. |
| `needs_human` → `acknowledgment` / `unclear` | 4 | Foto recebida e pedido de pessoa caem em balde genérico. |
| `price_inquiry` → `general_question` / `acknowledgment` | 3 | Pergunta de preço deixa de ser tratada como preço. |
| `clinical_urgency` → `general_question` / `book_appointment` | 3 | Bruxismo e orientação clínica passam como pergunta comum. |
| `acknowledgment` → `general_question` | 2 | Adiamento e interesse futuro viram pergunta. |
| Outras | 4 | — |

### Camada 2 — Decision

**A V1 não é mensurável nesta camada, e isto é um achado, não uma falha do eval.**

O `ActionResult` da V1 é construído inline dentro de
`ConversationOrchestrator.handle()`, no meio de leitura de agenda, catálogo e
estado. Não existe função `decide(understanding, state, config)` para chamar. E
não há registro histórico: o sink de trace é `noop` em produção, então nenhum
`ActionResult` de conversa real foi persistido. Medir exigiria replay com banco e
calendário, que não roda em CI.

Escrever aqui uma reimplementação das regras da V1 mediria a reimplementação.

O que a camada mede, então, é o **orçamento de pureza** que a V2 tem de respeitar:

| Métrica | Valor |
| --- | ---: |
| Casos decidíveis sem I/O | **55 de 66** (83%) |
| Casos que dependem de agenda/catálogo | 11 |
| Casos puros que o decisor de referência fecha | 49 de 55 |

Os 6 que sobram não foram ajustados para melhorar o número. Cada um tem causa
nomeada, e cada causa é requisito da V2:

- `greeting` × `general_question` depende de ser a primeira mensagem da conversa;
- `pipeline_photo_received` × `media_received` depende do estado do pipeline — e
  **o corpus histórico tem `state: null`, porque a V1 não persiste estado por
  turno de forma recuperável**;
- `clarification_needed` depende de consultar o catálogo do tenant, que é
  configuração e não entendimento.

### Camada 3 — Prosa

Parte determinística, sobre as respostas observadas:

| Métrica | V1 (33 respostas) | Humano (31) | Demo curada (13) |
| --- | ---: | ---: | ---: |
| Mediana de caracteres | 156 | 120 | 251 |
| Acima de 400 caracteres | 7 | 3 | 0 |
| Com 2+ perguntas | 9 | 1 | 0 |
| Citando preço fora do catálogo | 3 | 3 | 0 |
| Repetindo bloco já enviado | 2 | 0 | 0 |

Três leituras:

1. **A V1 pergunta demais.** 9 de 33 respostas trazem duas ou mais perguntas,
   contra 1 de 31 do humano e 0 de 13 da demo curada.
2. **O humano também erra preço.** Três respostas humanas citam valor que não
   está no catálogo do tenant. É a evidência direta de que resposta humana é
   candidata, nunca gabarito.
3. **A demo curada é mais longa e mais limpa.** 251 caracteres de mediana, zero
   violação determinística. O alvo de qualidade não é "resposta curta" — é
   resposta que responde antes de conduzir.

**Judge par a par: EXPERIMENTAL, NÃO É GATE.** Está implementado, com o controle de viés de
posição da spec (cada par julgado nos dois sentidos; veredito que inverte conta
empate), mas a conta Anthropic está sem crédito:

```
"blocked": true,
"reason": "Your credit balance is too low to access the Anthropic API."
```

Não foi substituído por OpenAI de propósito: o composer roda OpenAI, e usar a
mesma família removeria o controle de autopreferência que o judge existe para ter.
**O baseline semântico permanece PENDENTE** até a rodada existir de verdade.

### Estado final (C.7): experimental, não-gate

Duas rodadas, e a segunda foi pior que a primeira:

| | Rubrica original | Cinco dimensões + regra forte + fatos à vista |
| --- | ---: | ---: |
| Empates | 13/14 | **14/14** |
| Instabilidade ao inverter | 21,4% | **42,9%** (teto da spec: 25%) |
| Erros | 0 | 0 |

Em **7 dos 14 pares** apenas um lado falha no lastro sob os rótulos re-derivados,
e ainda assim ele empatou. A máquina não é o problema: sondado direto, escolhe o
preço do catálogo sobre um desconto de 50% não autorizado, com 8 tokens de saída.

**Nenhum gate depende deste número.** Factualidade e ação passam a ser medidas
pelas métricas determinísticas; qualidade de prosa, pelo checklist humano
calibrado. O judge fica como diagnóstico experimental, com implementação
preservada, para revisitar quando houver corpus maior, mais pares contrastantes
e evidência mais completa.

### Escopo e custo da rodada (medido no C.5)

| Item | Valor |
| --- | ---: |
| Provider/modelo configurado | Anthropic · `claude-sonnet-5` (`CORPUS_JUDGE_MODEL` sobrescreve) |
| Pares com resposta da IA **e** do humano | 14 de 66 |
| Julgamentos (cada par nos dois sentidos) | 28 |
| Tokens de entrada estimados | ~10.800 |
| Tokens de saída (`max_tokens: 16`) | ~450 |
| **Custo estimado da rodada** | **~US$ 0,03** (preço introdutório do Sonnet 5, US$ 2/US$ 10 por milhão até 31/08) |

O custo não é o obstáculo — a conta está sem crédito. Com `claude-haiku-4-5`
(US$ 1/US$ 5) a rodada sairia por ~US$ 0,01, mas Haiku é fraco demais para
julgamento comparativo aberto e não vale a economia de dois centavos.

### Quais casos precisam de judge

Dos 66 casos, **52 não têm par para julgar**: 19 têm só resposta da IA, 30 só
resposta humana, 3 não têm resposta nenhuma. O judge par a par só se aplica aos
14 restantes.

Desses 14, **2 já são decidíveis deterministicamente** — uma das duas respostas
viola uma regra objetiva (preço fora do catálogo, bloco repetido, mídia sem
texto, tamanho, excesso de perguntas) e a outra não, então a régua determinística
já separa as duas sem opinião de modelo. **12 precisam de judge**: as duas
respostas passam em todas as checagens objetivas e a diferença é qualitativa.

Isso reduz a rodada mínima de 28 para **24 julgamentos**, e é a fronteira que a
spec do judge pede: determinístico onde dá, judge só no resto.

### Custo

| Item | Valor |
| --- | --- |
| Chamadas por rodada de Understanding | 64 |
| Latência média | 1,26 s |
| Decision e prosa determinística | zero chamada, roda em CI |
| Judge | 28 chamadas por rodada, offline, fora do custo por conversa |

---

## Parte 2 — Descobertas

### O que o corpus confirmou

**Os intents carregam movimento de diálogo, e isso quebra.** A confusão
`confirm_slot` → `acknowledgment` aparece duas vezes em 64 casos, sempre no mesmo
formato: o lead responde a uma oferta pendente com "Pode confirmar" ou "Consigo
sim", e a mensagem, isolada, é mesmo um reconhecimento. Só o estado a distingue.
Separar `dialogueMove` de `request` é a correção certa.

**Objeção não é palavra-chave.** Os 11 casos com `signals.objection` não
compartilham vocabulário: "achei caro", "vou ver se consigo mês que vem", "tenho
medo de ficar artificial", "aquele vai ser um investimento muito alto", "não há
nada falando sobre promoção". Nenhum detector de string cobre esse conjunto.

**A ambiguidade de serviço é real e frequente onde importa.** 6 de 66 casos, e
todos em preço. `ambiguity.candidates` sobrevive por mérito.

### O que o corpus contrariou

**A distribuição de jornadas do plano estava errada.** Medido sobre 7.720 turnos
reais:

| Jornada | Plano previa | Volume real | Comentário |
| --- | ---: | ---: | --- |
| `other` (nenhuma regra reconhece) | — | **34,9%** | O maior balde do banco não estava no plano |
| rajada | 3 casos | 20,3% | Muito mais comum do que o previsto |
| primeiro contato | 4 casos | 15,7% | — |
| mídia | 3 casos | 7,3% | — |
| preço | 6 casos | 6,6% | Proporção correta |
| áudio | 2 casos | 4,3% | — |
| explicação de procedimento | 5 casos | **1,3%** | Pergunta explícita de procedimento é rara |
| objeção | 5 casos | **0,5%** | 40 turnos em 7.720 |
| comparação | 3 casos | 0,1% | 8 turnos |
| ambiguidade | 3 casos | 0,05% | 4 turnos |

Duas consequências. Primeiro: **um terço dos turnos reais não é reconhecido por
nenhuma regra de jornada** — são respostas curtas de meio de conversa ("pode ser",
"ok", "certo", "KKKKKK"), e é ali que a V1 mais devolve enchimento. Segundo:
**objeção é rara no histórico e central no produto.** O corpus a super-representa
de propósito (8 de 66), e isso é correto — mas nenhuma conclusão sobre frequência
de objeção pode sair daqui.

**O contraste IA × humano quase não existe.** O plano contava com ele como "o
sinal mais rico". Dos 7.720 turnos, só **273 (3,5%)** têm resposta da IA e do
humano dentro de duas horas. O corpus tem 14, e é quase tudo o que dava para ter.

**~~Metade dos turnos não é respondida.~~ CORRIGIDO no C.5 — ver abaixo.** A
primeira versão deste relatório afirmava que 3.770 de 7.720 turnos (48,8%)
ficaram sem resposta em duas horas. **O número estava errado** e a causa era do
extrator, não do produto: ele credita a resposta ao *último* turno antes dela, de
modo que numa rajada as mensagens anteriores do próprio lead apareciam como não
respondidas. Medido direto no banco, **6.123 de 7.720 (79,3%) são respondidos em
até duas horas** e apenas 264 (3,4%) nunca recebem resposta alguma. A análise
descritiva dos 1.597 restantes está em
[`corpus-unanswered-and-other.md`](./corpus-unanswered-and-other.md).

**A V1 não persiste estado por turno.** Descoberto ao montar o corpus: não há de
onde recuperar o `ConversationState` no momento de cada turno histórico, então os
41 casos históricos têm `state: null`. Isso limita hoje o eval de Decision e é
requisito para a V2 — a trilha precisa gravar estado por turno.

### O que não conseguimos representar

- **Estado da conversa** nos casos históricos, pelo motivo acima.
- **Mídia como conteúdo.** Três respostas do corpus são só imagem, sem texto, e
  estão marcadas `unjudgeable-media` com prosa nula. Não se avalia o que não se vê.
- **Áudio como áudio.** O corpus tem a transcrição quando ela existe no
  histórico; um caso ficou com `[MIDIA:AUDIO]` sem transcrição.
- **Preço entregue por imagem.** Um dos tenants manda valores em arte, a pedido
  do cliente. O texto da mensagem não contém o preço, e nenhuma verificação de
  preço determinística alcança isso.
- **Preço histórico.** Quatro casos têm tag `catalog-divergence`: o valor dito
  pela operadora não bate com o catálogo lido em 15/08, e a mensagem é de junho
  ou julho. Não dá para saber hoje qual preço estava em vigor. São os primeiros
  casos que pedem segunda opinião na revisão.

### Quais eixos parecem úteis

Ocupação medida nos 66 casos:

| Eixo | Ocupação | Veredito |
| --- | ---: | --- |
| `request` | 66/66 | **Essencial.** 30 valores distintos em 66 casos. |
| `signals.purchaseIntent` | 58/66 | Alta ocupação, **utilidade duvidosa** — ver abaixo. |
| `entities.service` | 35/66 | **Essencial.** É o eixo que amarra preço a serviço. |
| `dialogueMove` | 66/66, mas 47 são `new_topic` | **Útil onde não é `new_topic`.** Os 19 restantes são exatamente os casos que a V1 erra. |
| `signals.objection` | 11/66 | **Útil**, e não substituível por regex. |
| `entities.date` | 10/66 | Útil na jornada de agenda. |
| `ambiguity` | 6/66 | **Útil**, todos em preço. |
| `signals.sentiment` | 10/66 | **Sem uso demonstrado.** Não mudou nenhum `ActionResult` esperado. |
| `signals.priceSensitivity` | 8/66 | **Sem uso demonstrado.** Sempre acompanhado de `objection` ou `request: price-*`. |
| `safety.requestsHuman` | 3/66 | Raro, mas decisivo quando aparece. |
| `safety.emergency` | 2/66 | Raro; ambos vieram de comorbidade relatada, não de urgência. |
| `entities.quantity` / `ordinal` / `period` / `time` | 2–4/66 | Presentes, sem volume para julgar. |

`purchaseIntent` merece nota: aparece em 58 de 66 casos e **não determinou
nenhuma decisão** em nenhum deles. Ou ele ganha consumidor explícito na V2, ou
sai — campo que todo mundo preenche e ninguém lê é peso morto que parece
informação.

### Quais regras antigas parecem ter evidência real

- **Guard anti-saudação** (`coerceBusinessIntent`): 4 casos do corpus são
  exatamente a falha que ele existe para evitar, e ele não a evitou. A regra tem
  motivo real; a implementação por palavra-chave não cobre.
- **Ambiguidade recalculada em código** (`detectAmbiguousTreatmentTerm`): 6 casos
  a exigem. Sobrevive por mérito.
- **`isBusinessHoursQuestion`**: o caso `other-0004` mostra o dano — "como
  funciona" casa "funciona" e devolve horário. Sem evidência a favor no corpus.

### Novas dimensões que talvez sejam necessárias

1. **Política de repetição por convite.** O bug de CTA repetido e o de vídeo em
   loop são o mesmo defeito: convite sem memória de já ter sido feito. O
   `NextStep.repeatPolicy` da spec do Ciclo E responde a isso — e agora tem caso.
2. **Turno sem mensagem de lead.** Dois casos do corpus são outbound iniciado
   pela clínica. O pipeline da V2 precisa aceitar turno sem entrada de lead como
   caso de primeira classe, não como exceção.
3. **Resposta multi-parte.** Vários turnos reais são três ou quatro mensagens
   seguidas. Hoje o corpus as junta com `\n`, e o eval de tamanho mede o bloco,
   não a mensagem.
4. **Serviço fora do catálogo.** Dois casos históricos e dois sintéticos: o lead
   pede algo que o tenant não faz. Não há `ActionResult` para isso hoje; cai em
   `clarification_needed` por falta de opção melhor.

---

## Bugs novos encontrados

Registrados como caso de corpus, **não corrigidos**, conforme a regra do ciclo.

| Caso | Tag | O que acontece |
| --- | --- | --- |
| `price-0001`, `first-contact-0003`, `burst-0001`, `availability-0004` | `regression:saudacao-no-lugar-do-negocio` | Pergunta de preço, confirmação de horário e pergunta de agenda respondidas com o menu de boas-vindas |
| `availability-0001` | `regression:agenda-contradiz-recepcao` | A IA oferece cinco horários para amanhã e a recepção responde, no mesmo turno, que de manhã só há na segunda |
| `availability-0002` | `regression:disponibilidade-falsa` | "Temos sim" afirmado antes de saber o serviço, e a profissional não atende naquele dia |
| `media-0003` | `regression:foto-ack-contradiz-preavaliacao` | O turno anterior promete pré-avaliação "por aqui" e o seguinte diz que o especialista avaliará pessoalmente |
| `burst-0003` | `regression:rajada-responde-so-a-ultima` | Pergunta sobre lentes na mesma rajada é ignorada; a IA responde só o "bom dia" |
| `price-0004` | `regression:servico-trocado` | Lead pede cílios e limpeza; a IA responde limpeza e troca cílios por outro serviço |
| `objection-0001` | `regression:servico-inventado` + `preco-nao-autorizado` | Nomeia técnica que não existe no catálogo do tenant e cota preço que não é de nenhum serviço dele |
| `procedure-0001`, `other-0003` | `filler-response` | "Fico à disposição" para quem acabou de dizer que já pagou metade do tratamento |
| `media-0001`, `objection-0003` | `domain-leak` | Script odontológico ("o especialista irá avaliar seu caso", "que tal uma avaliação") num ateliê de bordado |
| `ambiguity-0001` | `script-fragment` | "Seria acessível para você?" respondido a quem perguntou de qual cidade a clínica é |

O `domain-leak` é o mais grave para a tese da V2: são duas ocorrências, no tenant
que não é clínica, do core aplicando vocabulário de saúde. É a evidência empírica
de que o core ramifica por domínio.

---

## O que falta para o Ciclo C estar completo

1. **Dupla revisão.** O corpus tem um revisor só. Material em
   [`corpus-review-guide.md`](./corpus-review-guide.md); a concordância entre
   revisores é desconhecida até a segunda passagem.
2. **Judge par a par.** Bloqueado por crédito na conta Anthropic.
3. **Repetição do baseline.** Rodada única; a variação observada entre duas
   execuções foi de 1,6 ponto.

## Correções aplicadas no C.5

- O número de turnos sem resposta estava errado por artefato do extrator, e foi
  corrigido acima. Nenhuma outra medida deste relatório depende dele.
- Identidade de tenant (nome comercial, prédio, bairro, estação) foi removida do
  corpus e do histórico da branch. Nenhum caso mudou de rótulo e o baseline foi
  remedido sem alteração.
