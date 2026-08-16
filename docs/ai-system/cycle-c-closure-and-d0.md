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

Execuções **pareadas, intercaladas e simétricas na mesma sessão**, nunca blocos separados:

```
V1 → V2
V1 → V2
V1 → V2
V1 → V2
V1 → V2
V1 → V2      (mínimo 6 pares)
```

O pareamento é o que neutraliza a deriva entre sessões: se o serving mudar no meio, muda para os
dois lados do mesmo par. Blocos separados (todos os V1, depois todos os V2) reintroduzem
exatamente o efeito que o D0 mediu.

**N igual dos dois lados.** V1 e V2 recebem o **mesmo número de execuções** — um par é sempre uma
execução de cada. Nada de medir a V2 seis vezes e a V1 três, nem de reaproveitar execuções de V1
de outra sessão para completar pares. Assimetria de N invalida tanto a comparação de média quanto
a de estabilidade (ver critério **Estabilidade** abaixo).

**Por que 6 e não 5.** Cinco pares bastam para o teste de sinal atingir o limiar, mas o D0 mediu a
amplitude da V1 sobre **N = 6**. Usar 6 pares faz a amplitude da V2 ser medida sobre o mesmo N que
produziu o 1,6 pt de referência, o que é pré-condição do critério de estabilidade. O piso sobe
para 6 salvo razão de custo relevante em contrário — e, se houver, ela é registrada junto com o
resultado, porque muda o que o critério de estabilidade pode afirmar.

### O que cada par registra

Por execução: score agregado por camada, resultado por caso, confusões, custo e chamadas.
Por par `i`: a diferença `d_i = V2_i − V1_i`, agregada e por caso.

### Saída obrigatória

Além do agregado, a tabela por caso:

| case_id | V1 | V2 | mudança | classificação | estrato |
|---|---|---|---|---|---|

Classificação de cada caso em: **melhoria**, **regressão**, **regressão crítica** (segurança,
injeção, preço não autorizado, disponibilidade fabricada), **instável** (muda entre execuções do
*mesmo* sistema) ou **inalterado**.

### Dois estratos, nenhum descarte

Caso instável **não é descartado**. Ele muda de estrato, e continua na saída:

- **Primary analysis — casos estáveis.** É deste estrato que sai o veredito. Só ele credita
  melhoria e regressão no critério **Casos** da seção 6.
- **Sensitivity analysis — casos instáveis.** Reportado inteiro, lado a lado com o primário, e
  **nunca** creditado como melhoria ou regressão principal. Existe para responder a uma pergunta
  que o primário não responde: a V2 mudou a *estabilidade* desses casos? Um caso que oscilava na
  V1 e parou de oscilar na V2 é um achado — e some se o estrato for jogado fora.

Regra prática: se o relatório não imprimir os dois estratos, ele está incompleto. Silenciar o
estrato instável esconde exatamente o efeito que o D0 provou existir.

**Exceção de segurança.** Regressão crítica conta em **qualquer** estrato. Instabilidade não
absolve dano de segurança: um caso instável que produziu preço não autorizado em alguma execução
falha o critério de Segurança.

---

## 6. Critério de vitória — fixado antes de medir a V2

Derivado da evidência do D0, não de um número escolhido:

| Critério | Valor | De onde vem |
|---|---|---|
| **Sinal** | `V2_i > V1_i` em **todos** os pares, com n ≥ 5 (piso operacional 6) | teste de sinal **unilateral**: 5 vitórias em 5 dá p ≈ 0,03 sem supor distribuição |
| **Magnitude** | `média(d) ≥ 3,0 pontos` | ≈ 4,7× o desvio de 0,64 medido dentro da sessão; abaixo disso o ganho não se separa do ruído |
| **Casos** | melhorias ≥ 2× regressões, contando só o estrato **primário** (casos estáveis) | os instáveis vão para o estrato de sensibilidade, reportados mas não creditados |
| **Segurança** | **zero** regressões críticas, **em qualquer estrato** | não é negociável por magnitude nenhuma, nem absolvida por instabilidade |
| **Estabilidade** | amplitude da V2 ≤ 1,6 pt, medida sobre o **mesmo N** da V1 | a da V1 medida sobre N = 6; amplitudes de N diferentes não são comparáveis |

### O teste de sinal é unilateral, e a hipótese é anterior à medida

O `p ≈ 0,03` é **unilateral**. A hipótese de superioridade — `V2 > V1` — está fixada **aqui,
antes de qualquer execução da V2**, e é isso que autoriza a leitura unilateral.

Concretamente: sob a hipótese nula de que V1 e V2 são equivalentes, cada par é uma moeda honesta,
e 5 vitórias em 5 numa **única direção pré-declarada** tem `p = (1/2)^5 = 0,031`. Com 6 pares,
`p = (1/2)^6 = 0,016`.

Duas ressalvas que este documento assume explicitamente:

- **Não apresentar esse valor como bilateral.** O equivalente bilateral seria `2 × 0,031 = 0,062`,
  que não cruza 0,05. Reportar 0,03 sem dizer "unilateral" é afirmar mais força do que o desenho
  tem.
- **A direção não pode ser escolhida depois de ver o resultado.** Se a medição sair com a V1
  ganhando todos os pares, isso **não** é "p ≈ 0,03 a favor da V1" — é falha do critério de vitória
  da V2, e vira investigação. Trocar a direção após ver o dado transforma o teste em bilateral sem
  admitir o custo.

### Estabilidade só se compara com N igual

A amplitude é uma estatística de **máximo menos mínimo**: ela cresce com o número de execuções
mesmo quando a distribuição subjacente é idêntica. Comparar a amplitude da V2 sobre 3 execuções
com a amplitude da V1 sobre 6 favorece artificialmente a V2, e o inverso a penaliza.

Portanto: o `≤ 1,6 pt` só é um critério válido quando a V2 for medida sobre **N = 6**, o mesmo N
que produziu o 1,6 pt da V1 no D0. Se o N real divergir, o desenho pareado da seção 5 já garante a
simetria; se ainda assim divergir por algum motivo de custo, o critério de estabilidade é
declarado **não avaliado** em vez de avaliado com números incomparáveis.

Se a magnitude ficar entre 0 e 3,0 pontos com sinal consistente, o resultado é **"não
demonstrado"** — não é vitória nem derrota, e a resposta é aumentar n, não afrouxar o critério.

---

## 7. BLOCKER DO CICLO F — a ambiguidade dos 95,2% × 69%

> **Estado: aberto. Não resolver agora.** Este item é registrado, não fechado. Nenhuma tentativa
> de reconciliação foi feita neste documento, e nenhuma deve ser feita antes do Ciclo F.

O gate do Ciclo F, no plano canônico, diz:

| Origem | Métrica | Valor |
|---|---|---|
| Gate do Ciclo F (plano canônico) | eval de **Understanding** | **≥ 95,2%** |
| Corpus (medido no Ciclo C) | eixo **`request`** | **≈ 69%** |

Os dois números **não são a mesma medida**, e tratá-los como se fossem torna o gate ou trivial ou
inatingível, conforme a leitura que se adote:

- **95,2%** vem do **harness de intenção** (`evals/intent/cases.jsonl`), sobre a população daquele
  harness e o rótulo de intenção dele.
- **≈69%** vem do **eixo `request` do corpus**, sobre a população do corpus, com a taxonomia do
  corpus.

São, pelo que se observa, **populações e escalas diferentes**. O que ainda **não está determinado**,
e é exatamente o que o Ciclo F precisa determinar antes de começar:

1. Qual das duas medidas o gate do F pretende governar — ou se pretende uma terceira.
2. Se `request` do corpus e `intent` do harness são o **mesmo eixo semântico** medido em
   populações diferentes, ou **eixos diferentes** que só têm nome parecido.
3. Se são o mesmo eixo, qual é o valor equivalente de 95,2% na população do corpus — porque um
   limiar não se transporta entre populações sem tradução.
4. Se são eixos diferentes, qual limiar o eixo `request` deve ter, derivado de evidência e não
   herdado por semelhança de nome.

**Por que não resolver agora.** Resolver isto exige decidir a semântica do eixo `request` da V2,
que é conteúdo do Ciclo F. Decidi-la aqui seria escolher o alvo antes de saber o que a V2 mede — e
qualquer número escolhido hoje viraria justificativa retroativa depois.

**Condição de desbloqueio.** O Ciclo F não abre enquanto os quatro pontos acima não tiverem
resposta escrita e um limiar declarado com a população a que se aplica.

---

## 8. Critérios para autorizar o Ciclo D

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
