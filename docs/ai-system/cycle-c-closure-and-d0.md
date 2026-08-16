# Encerramento do Ciclo C e D0 — estabilidade da medição

Este documento fecha o Ciclo C do plano canônico
([`docs/superpowers/plans/2026-08-15-conversation-intelligence-v2.md`](../superpowers/plans/2026-08-15-conversation-intelligence-v2.md))
e registra a investigação D0, feita antes de qualquer implementação do Ciclo D.

---

## 1. Onde estamos no plano canônico

| Ciclo | O que é | Estado |
|---|---|---|
| A | Congelamento da V1 | fechado |
| B | Buracos conhecidos da V1 | fechado |
| **C** | **Corpus e evals** *(caminho crítico)* | **fechado aqui** |
| D | Instrumentar a camada de keywords | autorizável |
| E | Core V2 mínimo | depende de D |
| F–H | Domain pack, capabilities, composer | depende de E |
| I | **Shadow e comparação V1 × V2** | onde o protocolo abaixo pertence |
| J | Cutover e limpeza | último |

**Correção de rota registrada.** O Ciclo D do plano canônico **não** compara V1 com V2 — ele
instrumenta os 30 predicados de keyword e classifica cada um como *feature* ou *cicatriz*, sem
remover nenhum. A comparação V1 × V2 é o **Ciclo I**, com critérios na seção 14 da spec. O
protocolo experimental desenhado na seção 5 deste documento é, portanto, instrumento do Ciclo I,
não do D. Tratá-lo como D criaria um fluxo paralelo ao plano.

---

## 2. Encerramento formal do Ciclo C

### Régua calibrada e congelada

`review-checklist.v2-calibrada`, digest SHA-256 das quatro perguntas travado em
`CALIBRATED_QUESTIONS_DIGEST` e verificado em teste. Alterar uma palavra de qualquer pergunta
quebra o build — a concordância medida é propriedade deste texto exato.

### Concordância final (C.9)

| Pergunta | Resultado | Limiar |
|---|---|---|
| `factuallyCorrect` | **91,7%** | 80% ✅ |
| `addressedWhatTheLeadRaised` | **91,7%** | 80% ✅ |
| `advancedTheJourney` | **87,5%** | 80% ✅ |
| `wouldRepeatToday` | **87,5%** | 80% ✅ |

As quatro perguntas ficaram acima do limiar. Divergências caíram de **19 para 10** entre a rodada
C.8 e a C.9, sobre uma amostra cega com 16 de 20 casos inéditos.

### Dívida de adjudicação — não corrigida de propósito

Dois rótulos do primeiro revisor estão errados e permanecem como estão:

| Caso | Campos | O erro |
|---|---|---|
| `procedure-0001` (humano) | `factuallyCorrect`, `wouldRepeatToday` | "depois vou te mandar msg" é ação futura prometida sem registro |
| `media-0002` (humano) | `factuallyCorrect`, `advancedTheJourney`, `wouldRepeatToday` | "realizamos uma pré-avaliação" é ação afirmada sem side effect |

Os dois são o mesmo tipo de erro, e é um tipo que a régua já reprova em `audio-0001`,
`handoff-0003` e `location-0001`. **Não foram corrigidos nesta rodada**: corrigi-los na mesma
respiração em que se mede a concordância elevaria dois campos sem que nenhum terceiro revisor
conferisse a correção. Ficam como dívida declarada, a ser adjudicada em passo próprio.

### Ressalva do baseline V1

- medida histórica: **73,4%**
- medida atual: **68,8%**, repetida em três execuções consecutivas
- a causa da diferença de **4,7 pontos** foi investigada no D0 abaixo e **não foi determinada**

---

## 3. D0 — investigação da estabilidade da medição

### Condições comparadas

| Condição | Histórico | Atual | Igual? |
|---|---|---|---|
| Código da V1 (`src/core/`) | fc66ec97 | HEAD | **sim** — `git diff --stat` vazio |
| Evaluator (`scripts/eval-corpus.ts`) | — | — | **sim** |
| Modelo | `gpt-5.4-mini` | `gpt-5.4-mini` | **sim** |
| Temperatura | 0 | 0 | **sim** |
| SDK OpenAI | 6.39.0 | 6.39.0 | **sim** |
| Dataset | 66 casos, 64 comparáveis | idem | **sim** |
| `input` dos casos divergentes | — | — | **sim**, byte-idêntico |
| Nomes de serviço enviados ao modelo | — | — | **sim**, lista e ordem |
| Rótulos esperados (`understanding.request`) | — | — | **sim**, intocados pelo C.8 e C.9 |
| Fixtures (política, mídia, completude) | — | — | **não** — mas nada disso chega ao classificador |

O evaluator só entrega ao classificador a mensagem do lead e a **lista de nomes** de serviço. As
mudanças de fixture do C.9 (política destruncada, mídia nomeada, completude declarada) não entram
nessa chamada.

### Distribuição medida

Seis execuções consecutivas hoje, mesmo código e mesma entrada:

```
68,8  68,8  68,8  68,8  70,3  68,8
média 69,0%   desvio 0,64   amplitude 1,6 pt   intervalo [68,8 , 70,3]
```

A medida histórica de **73,4% está 3,1 pontos acima do máximo observado** nas seis. Ela não cabe
na banda de ruído medida hoje.

### Temperatura 0 não é determinismo

Cinco casos oscilam entre execuções, com a mesma entrada e `temperature: 0`:

| Caso | 6 execuções |
|---|---|
| `burst-0003` | greeting, greeting, acknowledgment ×4 |
| `discount-0001` | price_inquiry ×4, correto ×2 |
| `first-contact-0003` | correto ×4, acknowledgment ×2 |
| `objection-0005` | clinical_urgency ×1, correto ×5 |
| `price-0003` | correto ×2, book_appointment ×4 |

### Resposta à pergunta central

**A diferença vem das duas coisas, e a proporção é medida.** Dos 6 casos que diferem da medida
histórica, **4 estão no conjunto que oscila** — churn estocástico. **2 são estáveis nas seis
execuções e mesmo assim diferentes do histórico**:

| case_id | V1 antiga | V1 atual | mudou? | evidência |
|---|---|---|---|---|
| `first-contact-0005` | correto | `greeting` | **sim** | errado em 6/6 hoje, certo no histórico |
| `objection-0006` | correto | `acknowledgment` | **sim** | errado em 6/6 hoje, certo no histórico |
| `burst-0003` | acknowledgment | greeting | sim | oscila entre execuções |
| `discount-0001` | correto | price_inquiry | sim | oscila entre execuções |
| `first-contact-0003` | acknowledgment | correto | sim | oscila entre execuções |
| `objection-0005` | correto | clinical_urgency | sim | oscila entre execuções |
| outros 15 | — | — | não | estáveis e iguais |

47/64 → ~44/64 são ~3 casos. Dois deles são regressão estável; o restante é churn.

### Causa: **não determinada**

Tudo que está sob controle do repositório é idêntico: código, evaluator, prompt, dataset, entrada
dos casos, nomes de serviço, rótulos esperados, modelo, temperatura e SDK. As hipóteses que
sobram estão fora do repositório — mudança de serving do mesmo identificador de modelo no
provedor, ou uma taxa de flip baixa demais para seis amostras enxergarem nesses dois casos.

Não há evidência para escolher entre elas daqui, e nenhuma explicação foi inventada para fechar o
item. Fica como **incerteza conhecida**, registrada em
[`measurement-stability-d0.json`](../../evals/corpus/measurement-stability-d0.json).

---

## 4. Conclusão sobre a estabilidade do baseline

1. **Uma execução única não é uma medida.** Dentro da mesma sessão a amplitude é 1,6 ponto; entre
   sessões separadas por horas, a diferença observada foi 4,7 pontos.
2. **A instabilidade é por caso, não uniforme.** Cinco casos concentram todo o churn; os outros 59
   não se mexem. Isso significa que um ganho pequeno pode ser inteiramente explicado por dois ou
   três casos instáveis mudando de lado.
3. **Comparar V1 medido ontem com V2 medido hoje é inválido.** A deriva entre sessões é maior que
   qualquer ganho arquitetural modesto.

---

## 5. Protocolo V1 × V2 — instrumento do Ciclo I

### Desenho

Execuções **pareadas e intercaladas na mesma sessão**, nunca blocos separados:

```
V1 → V2 → V1 → V2 → V1 → V2 → …   (mínimo 5 pares)
```

O pareamento é o que neutraliza a deriva entre sessões: se o serving mudar no meio, muda para os
dois lados do mesmo par. Blocos separados (todos os V1, depois todos os V2) reintroduzem
exatamente o efeito que o D0 mediu.

### O que cada par registra

Por execução: score agregado por camada, resultado por caso, confusões, custo e chamadas.
Por par `i`: a diferença `d_i = V2_i − V1_i`, agregada e por caso.

### Saída obrigatória

Além do agregado, a tabela por caso:

| case_id | V1 | V2 | mudança | classificação |
|---|---|---|---|---|

Classificação de cada caso em: **melhoria**, **regressão**, **regressão crítica** (segurança,
injeção, preço não autorizado, disponibilidade fabricada), **instável** (muda entre execuções do
*mesmo* sistema) ou **inalterado**. Caso marcado instável não conta como melhoria nem como
regressão — ele é ruído conhecido e entra numa coluna à parte.

---

## 6. Critério de vitória — fixado antes de medir a V2

Derivado da evidência do D0, não de um número escolhido:

| Critério | Valor | De onde vem |
|---|---|---|
| **Sinal** | `V2_i > V1_i` em **todos** os pares, com n ≥ 5 | teste de sinal: 5 vitórias em 5 dá p ≈ 0,03 sem supor distribuição |
| **Magnitude** | `média(d) ≥ 3,0 pontos` | ≈ 4,7× o desvio de 0,64 medido dentro da sessão; abaixo disso o ganho não se separa do ruído |
| **Casos** | melhorias ≥ 2× regressões, contando só casos **estáveis** | os 5 instáveis medidos não podem ser creditados a nenhum dos lados |
| **Segurança** | **zero** regressões críticas | não é negociável por magnitude nenhuma |
| **Estabilidade** | amplitude da V2 dentro da sessão ≤ 1,6 pt | a da V1 medida; ganho comprado com instabilidade não é ganho |

Se a magnitude ficar entre 0 e 3,0 pontos com sinal consistente, o resultado é **"não
demonstrado"** — não é vitória nem derrota, e a resposta é aumentar n, não afrouxar o critério.

### Ambiguidade do plano que precisa ser resolvida antes do Ciclo F

O gate do Ciclo F diz "eval de Understanding ≥ 95,2%". Esse número vem do **harness de intenção**,
não do eixo `request` do corpus, que está em 69%. São escalas diferentes sobre populações
diferentes, e conflacioná-las tornaria o gate inatingível ou trivial conforme a leitura. A
resolução dessa ambiguidade é pré-condição do Ciclo F, não deste documento.

---

## 7. Critérios para autorizar o Ciclo D

O Ciclo D (instrumentar keywords) **não depende** da estabilidade do baseline: ele conta disparos
de predicado e divergências do classificador, e é aditivo e sem efeito de comportamento. As
pré-condições reais são:

- [x] Ciclo C fechado, régua calibrada e congelada
- [x] `npm run verify` verde
- [x] Auditoria de PII limpa sobre working tree, commits e blobs
- [x] Corpus carregando 66 casos em CI
- [x] Instabilidade do baseline medida e registrada — para que o relatório de D não credite a
      predicado nenhum uma divergência que é churn do classificador

O item que **fica em aberto** e pertence ao Ciclo I, não ao D: a causa dos 4,7 pontos.
