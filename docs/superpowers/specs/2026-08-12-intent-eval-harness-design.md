# Eval de intenção com baseline ponderada por severidade

Data: 2026-08-12
Status: aprovado, execução autorizada
Fase: endurecimento da Fase 2 (motor conversacional seguro) — gate que nunca fechou

## 1. Decisão

Construir um harness de avaliação offline para o `IntentClassifier`: dataset rotulado
versionado, runner que chama o modelo real, e baseline commitada com métrica ponderada
por severidade de confusão.

O harness não altera nenhum caminho de produção. Ele só lê o classificador.

## 2. O problema, com evidência

Três fatos verificados em `origin/main` (ad1760f):

1. **O prompt do classificador virou rastreador de bugs.** O system prompt em
   `src/core/intelligence/IntentClassifier.ts` tem cerca de 120 linhas de regras
   marcadas `REGRA CRÍTICA`, `PRIORIDADE ALTA` e `EXCEÇÃO IMPORTANTE`. Cada uma é a
   cicatriz de um incidente. Nesse volume as regras interagem: a regra 18 degrada a
   regra 7 sem ninguém perceber.

2. **A acurácia do classificador nunca foi medida.** Não existe accuracy, precision,
   recall ou matriz de confusão no repositório. Os testes **stubam o LLM** — validam
   como o orquestrador *trata* um intent recebido, nunca se o modelo *acerta* o intent.
   As golden expectations em `src/application/replay/evaluate-golden-expectations.ts`
   checam estrutura (estágios de trace, contagem de outbound, estado final), não
   correção semântica. E o CI não tem chave de LLM alguma: `npm run verify` roda
   inteiramente stubado.

3. **O campo `confidence` é ficção.** É um número que o próprio modelo emite, não
   probabilidade calibrada. Qualquer decisão que dependa dele depende de ruído.

Consequência direta: toda mudança de prompt ou de modelo é feita no escuro, e é por
isso que os mesmos bugs conversacionais reaparecem.

### 2.1 O que já existe e é aproveitado

O repositório está mais preparado do que o problema sugere:

- `DecisionTrace` com os estágios `intent.classified` e `intent.resolved` separados —
  o par bruto/corrigido é observável.
- `ResponseValidator` determinístico barrando preço, horário e promessa fora do plano.
- `response_format: json_schema` com `strict: true` e `temperature: 0` — saída
  estruturada feita corretamente.
- O modelo já é configurável por ambiente:
  `const MODEL = process.env.OPENAI_CLASSIFIER_MODEL?.trim() || "gpt-4o-mini"`.

## 3. Fonte da verdade-base

Os testes existentes já contêm triplas `(texto, intent errado do modelo, intent correto)`.
Exemplo real de `src/__tests__/BusinessIntentCoercion.test.ts`:

```ts
coerceBusinessIntent({
  message: "Olá! Posso ter mais informações sobre custo ?",
  intent: "acknowledgment",   // o que o gpt-4o-mini devolveu em produção
  treatments,
  isClinicSegment: true,
});
expect(result).toBe("price_inquiry");   // o rótulo correto
```

O campo `intent` é o modo de falha documentado do modelo real naquele texto exato. Isso
torna o dataset utilizável para duas perguntas distintas: *"qual a acurácia?"* e
*"o modelo novo ainda erra isto?"*.

**Contagem verificada por leitura, não por estimativa.** Uma passagem anterior desta spec
falava de cerca de 90 casos. Esse número contava blocos `it(` em arquivos que exercitam
várias funções, não chamadas de `coerceBusinessIntent`. O número real é 23:

| Arquivo | Triplas de intent |
| --- | --- |
| `BusinessIntentCoercion.test.ts` | 10 |
| `P0.1-anti-greeting.test.ts` | 13 |
| `DirectTreatmentMention.test.ts` | 0 — testa resolução de tratamento, outra dimensão |
| `StopContactIntent.test.ts` | 1, já contido nos 10 acima |
| `NeedsHumanHandoff.test.ts`, `XimendesConversationPatterns.test.ts`, `PendingSlotChoice.test.ts` | 0 — orquestrador com LLM stubado |

23 casos cobrem 7 dos 17 intents (`price_inquiry` 8, `patient_arrived` 3, `needs_human` 3,
`greeting` 3, `general_question` 3, `book_appointment` 2, `acknowledgment` 1). Nenhum caso
para `stop_contact` ou `clinical_urgency`, que são justamente os de severidade crítica.

23 é pouco para uma taxa: um caso virando move o número em mais de quatro pontos. Então o
dataset tem **dois estratos, reportados separadamente e nunca somados**:

**Estrato A — incidentes reais (23 casos).** Texto de lead verdadeiro, com o erro do modelo
documentado. Mede generalização nos casos que realmente quebraram em produção. É o estrato
que governa o gate.

**Estrato B — regras do prompt.** O system prompt carrega 201 frases entre aspas dentro das
suas próprias regras (`"quanto custa"`, `"cheguei"`, `"me tira dessa lista"`, …), cada uma
com o intent que a regra manda aplicar. Extraí-las mede **aderência à regra**, não
generalização: uma frase que a própria instrução nomeia e o modelo ainda erra é a evidência
direta de que as regras estão se degradando entre si. Este estrato cobre os 17 intents,
inclusive os críticos que o estrato A não alcança.

A distinção é obrigatória no relatório. Acerto no estrato B não é prova de qualidade em
conversa real; erro no estrato B é prova de que uma regra escrita não está valendo.

### 3.1 Por que não colher de produção agora

Duas barreiras, ambas verificadas:

- A tabela `decision_traces` é sanitizada por design: *"Nunca armazena mensagem, prompt,
  resposta, telefone, nome ou URL"*. Ela dá o par de rótulos e o `conversationId`, mas não
  o texto de entrada. Recuperar o texto exige join em `messages`.
- Os quatro clientes estão pausados, então não há tráfego gerando trilha nova. A tabela
  tem `expiresAt` e cron de limpeza — é efêmera por design.

Colheita contínua fica atrás do piloto (Fase 7).

## 4. Não-objetivos

Nomeados para não virarem escopo silencioso:

- Não altera código de produção. Nem prompt, nem guards, nem orquestrador.
- Não separa as responsabilidades do classificador (vira spec própria, ver §11).
- Não troca de modelo (vira spec própria, habilitada por esta).
- Não mede tom, persuasão ou qualidade de texto — só correção de intent.
- Não adiciona segredo ao CI nesta etapa.
- Não otimiza prompt automaticamente. Com ~90 casos isso produziria overfit.

## 5. Arquitetura

```
evals/intent/
  cases.jsonl        casos dos dois estratos, um por linha, versionado
  severity.ts        matriz de custo por par (esperado, obtido)
  baseline.json      resultado commitado do modelo corrente, por estrato
scripts/eval-intent.ts   runner: instancia o IntentClassifier real
```

Fronteiras:

- O runner importa `IntentClassifier` e o chama como produção chama. Nenhum mock.
- A suíte vitest não é tocada: segue rápida, gratuita e stubada.
- `npm run verify` não muda de comportamento nem de custo.

JSONL em vez de módulo TypeScript: adicionar caso é uma linha, o diff é legível, e dois
PRs que adicionam casos não conflitam.

## 6. Formato do caso

O classificador precisa de contexto para operar, então o caso carrega o contexto:

```json
{
  "id": "tania-custo-01",
  "stratum": "incident",
  "message": "Olá! Posso ter mais informações sobre custo ?",
  "expected": "price_inquiry",
  "observedLlmIntent": "acknowledgment",
  "source": "src/__tests__/BusinessIntentCoercion.test.ts:59",
  "context": {
    "isFirstContact": true,
    "hasPendingSlotOffer": false,
    "treatments": ["Lentes de resina composta", "Clareamento dental"]
  },
  "history": []
}
```

- `stratum` — `"incident"` (texto real de lead) ou `"prompt_rule"` (frase que a própria
  regra do prompt nomeia). Governa o agrupamento do relatório; os estratos nunca somam.
- `expected` — rótulo, um dos 17 valores de `IntentType`.
- `observedLlmIntent` — opcional; o erro documentado do modelo, quando o caso de origem
  o registra. Habilita a pergunta de retirada de guard.
- `source` — rastreabilidade até o teste que originou o caso.
- `context` e `history` — o que `classify()` exige: primeiro contato, oferta pendente,
  lista de tratamentos com aliases, histórico recente.

Casos sem `expected` válido são rejeitados na carga, não ignorados em silêncio.

## 7. Métrica: severidade antes de acurácia

Confundir `greeting` com `acknowledgment` é inócuo. Perder um `stop_contact` é risco
regulatório. Um número único apaga essa diferença.

| Nível | Confusões | Custo real |
| --- | --- | --- |
| Crítica | `stop_contact` perdido; `clinical_urgency` perdido; `patient_arrived` perdido | opt-out violado; dor tratada como pergunta comum; paciente na recepção sem atendimento |
| Alta | `price_inquiry` recebido como `greeting` ou `acknowledgment`; `confirm_slot` trocado com `reject_slots`; `needs_human` falso-negativo | conversa entra no trilho errado; agenda errada; pedido humano ignorado |
| Média | `general_question` trocado com `book_appointment`; `needs_human` falso-positivo | atrito recuperável; recepção recebe ruído |
| Baixa | `greeting` com `acknowledgment`; `farewell` com `acknowledgment` | quase inócuo |

A matriz vive em `evals/intent/severity.ts`, isolada, para que revisar custo de negócio
seja edição de um arquivo e não caça pelo runner.

**Regra do gate:** regressão em Crítica ou Alta é reprovação; o runner sai com código
diferente de zero. Na etapa 1 (§9) isso reprova a execução local, não o CI — nenhum PR é
travado até a promoção da etapa 2. Acurácia plana é reportada e nunca reprova: ela pode
cair legitimamente enquanto o que importa sobe.

Consequência a registrar: como o estrato A não tem nenhum caso de `stop_contact` nem de
`clinical_urgency`, o nível Crítica só tem onde morder no estrato B enquanto o estrato A
não crescer. O gate é aplicado aos dois estratos por isso, com a ressalva de que reprovação
crítica vinda de B significa "uma regra escrita não está valendo", não "o modelo falha com
lead real".

## 8. Runner: saída, variância e falha

`temperature: 0` não garante determinismo na OpenAI. O runner aceita `--repeat N` e a
baseline grava média e dispersão observada. As primeiras rodadas locais existem
justamente para medir o ruído antes de qualquer limiar virar gate.

```
Modelo: gpt-4o-mini   Rodadas: 3

Estrato A — incidentes reais (23 casos)
  Acertos: 15/23 (65.2%, ±2.1)
  Falhas:  crítica 0   alta 6   média 2   baixa 0
  Confusões:  price_inquiry <- acknowledgment  4x
              patient_arrived <- acknowledgment  2x

Estrato B — aderência às regras do prompt (118 casos)
  Acertos: 104/118 (88.1%, ±1.4)
  Regras que o modelo não obedece:  stop_contact <- farewell  5x

Erros de execução: 0
Diff vs baseline: sem regressão
```

`--json` desde o início, para que a promoção a CI não exija retrabalho.

**Erro de execução nunca contamina a medição.** O classificador roda com `maxRetries: 0`,
então um 429 ou timeout hoje degrada para `unclear`. No runner isso apareceria como erro
do modelo. Portanto: falha de API é contada como erro de execução, reportada em linha
própria, e não conta como acerto nem como erro de classificação. Acima de 5% dos casos o
runner aborta em vez de publicar número sujo.

Custo: o system prompt domina cada chamada (cerca de 2 mil tokens), então uma passagem por
todos os casos fica na ordem de centenas de milhares de tokens de entrada em `gpt-4o-mini`
— alguns centavos de dólar. Com `--repeat 3`, ainda abaixo de US$ 0,25. O runner imprime o
total real de tokens consumidos, para que o número pare de ser estimativa na primeira
rodada.

## 9. Gate: local agora, CI depois

Etapa 1 — comando local (`npm run eval:intent`), executado antes de mexer em prompt ou
modelo. Sem segredo novo no GitHub, sem risco de travar PR por flake.

Etapa 2 — depois de 2 a 3 rodadas provarem a dispersão da baseline, promover a gate
bloqueante em PRs que toquem o classificador, com limiar derivado da variância medida.
A promoção exige `OPENAI_API_KEY` como secret e é decisão separada, tomada com o número
na mão.

## 10. Verificação

O harness está pronto quando:

1. `npm run eval:intent` roda ponta a ponta contra a API real e imprime o relatório.
2. `evals/intent/baseline.json` está commitada com resultado de pelo menos 3 rodadas.
3. Um caso deliberadamente corrompido (rótulo trocado) faz o diff de baseline reportar
   regressão — o gate é provado, não presumido.
4. `npm run verify` continua passando com o mesmo tempo e sem chave de LLM.
5. A dispersão observada está registrada, permitindo escolher limiar na etapa 2.

## 11. O experimento da interferência

Dentro do escopo desta spec, porque é medição e não refatoração.

A chamada `classify()` faz cinco trabalhos: classificação de intent em 17 vias, resolução
de tratamento com aliases e sinônimos, extração de preferência de horário, detecção de
ambiguidade entre famílias e decisão de clarificação. No mesmo prompt, cerca de 20 linhas
de regra de tratamento competem com cerca de 100 de regra de intent.

A hipótese é interferência de tarefa. O experimento: medir a acurácia de intent com e sem
a lista de tratamentos no prompt, sobre o mesmo dataset. Se subir sem ela, a interferência
é real e a separação de responsabilidades passa a ter evidência.

O resultado alimenta a spec seguinte. Nenhuma separação é executada aqui.

## 12. Riscos

- **Estrato A é pequeno.** 23 casos: um caso virando move a taxa em mais de quatro pontos,
  e não há caso algum de `stop_contact` nem de `clinical_urgency`. Mitigação: reportar
  contagem absoluta de acertos ao lado da porcentagem, nunca a taxa sozinha, e crescer o
  estrato com histórico sanitizado numa etapa posterior.
- **Estrato B não prova qualidade.** Aderência a frases que a própria instrução nomeia é
  o piso, não o teto. Um modelo pode acertar 100% do estrato B e ainda descarrilar em
  conversa real. O relatório precisa deixar isso explícito para quem lê o número.
- **Disciplina.** O harness só acumula valor se cada bug corrigido virar um caso novo.
  É compromisso de processo, não propriedade automática do código.
- **Overfit se otimizado cedo.** Otimização automática de prompt sobre 90 casos produz
  algo pior no mundo real. Explicitamente proibido até o dataset crescer.

## 13. Specs futuras habilitadas por esta

Nenhuma delas é avaliável sem a baseline; todas ficam bloqueadas até ela existir.

1. Separação de responsabilidades do classificador: intent no LLM, resolução de
   tratamento determinística ou vetorial, parsing de data sem LLM.
2. Comparação de modelos: acurácia por severidade, latência e custo por turno entre
   `gpt-4o-mini` e um modelo atual. Barata, dado que `OPENAI_CLASSIFIER_MODEL` já existe.
3. Retirada de guards com evidência: se o modelo acerta nativamente os casos que
   originaram um guard, o guard é peso morto. Isso reduz o orquestrador de 8.318 linhas
   por deleção, o que é preferível à extração de seam prevista na §8.1 da spec mestre.
4. Abstenção calibrada por logprobs, substituindo o campo `confidence` autodeclarado.
5. Resolução de tratamento por embeddings em pgvector no Neon existente, tornando
   ambiguidade uma medida de distância em vez da próxima regra de prompt.

## 14. Tecnologias avaliadas e recusadas

**LangGraph, e frameworks de orquestração agêntica em geral: recusado.** LangGraph resolve
o loop em que o LLM decide o caminho, com tool-calling dinâmico e checkpoint próprio. A
invariante desta arquitetura (§8 da spec mestre) é a oposta: *"o LLM entende e verbaliza;
o sistema decide"*. O problema que o framework resolve foi projetado para fora de
propósito. Somando: a durabilidade dele duplicaria jobs, lease, dedupe e outbox já
existentes; é Python-first; e adotá-lo acrescenta serviço e salto de latência a um sistema
com meta de p95 abaixo de 15 segundos.

**Multi-agente, RAG sobre documentos e vector database separado: recusados** pelo mesmo
teste — resolvem problemas que este sistema não tem. A necessidade de similaridade
semântica que existe (resolução de tratamento) é atendida por pgvector no Postgres já
provisionado.

**Fine-tuning e distilação: adiados, não recusados.** São legítimos e podem substituir o
prompt de 120 regras por um modelo pequeno mais rápido e consistente. Exigem centenas a
milhares de exemplos rotulados, o que esta spec começa a produzir.
