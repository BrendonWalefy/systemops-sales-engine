# Comparação de modelos do classificador de intenção

Data: 2026-08-13
Harness: `npm run eval:intent` (PR #263)
Dataset: 79 casos — estrato A com 21 incidentes reais, estrato B com 58 frases das regras do prompt
Rodadas: 2 por candidato; a baseline `gpt-4o-mini` tem 3
Erros de execução: 0 em todos
Cotação usada: US$ 1 = R$ 5,161053 (13/08/2026)

## 1. Resultado

| Modelo | Estrato A | acertos/21 | crít/rodada | alta/rodada | Estrato B | amplitude | R$/clínica/mês¹ | latência |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **gpt-5.4-mini** | **95,2%** | 20,0 | **0** | **0** | **100%** | **0 pp** | R$ 8,30 | 1.157 ms |
| gpt-4.1-mini | 90,5% | 19,0 | 1,0 | 1,0 | 98,3% | 0 pp | R$ 5,82 | **768 ms** |
| gpt-5.6-sol | 83,3% | 17,5 | 0 | 2,5 | 100% | 4,8 pp | R$ 49,24 | — |
| gpt-5.6-terra | 83,3% | 17,5 | 0 | 2,5 | 100% | 4,8 pp | R$ 14,68 | 1.025 ms |
| gpt-5.6-luna | 81,0% | 17,0 | 0 | 3,0 | 100% | 0 pp | **R$ 2,03** | 1.290 ms |
| gpt-5.4-nano | 81,0% | 17,0 | 0 | 3,0 | 100% | 0 pp | R$ 2,28 | 782 ms |
| gpt-4o-mini (produção) | 73,0% | 15,3 | 2,0 | 3,0 | 92,5% | 4,8 pp | R$ 3,90 | 1.672 ms |
| gpt-4.1-nano | 57,1% | 12,0 | 1,5 | 6,5 | 81,0% | 9,5 pp | R$ 1,46 | 683 ms |

¹ 300 conversas/mês × ~10 mensagens de lead = 3.000 classificações, com cache de prompt aquecido.

## 2. O achado principal: fronteira perde de modelo pequeno

`gpt-5.6-sol` custa **R$ 49,24** por clínica/mês e faz **83,3%**. O `gpt-5.4-mini` custa
**R$ 8,30** e faz **95,2%**. Seis vezes o preço para acurácia menor.

Sol e Terra também têm amplitude de 4,8 pp entre rodadas, enquanto `gpt-5.4-mini` e os dois
`nano` são perfeitamente determinísticos (0 pp). Os modelos caros são **menos consistentes**
justamente na tarefa em que consistência é o produto.

A explicação é a natureza da tarefa: classificação em 17 vias com `json_schema` estrito e
120 linhas de regra é seguir instrução, não raciocinar em aberto. Modelo de fronteira é
otimizado para o segundo. Paga-se por capacidade que não entra no resultado.

## 3. Nenhuma razão para permanecer no gpt-4o-mini

O modelo de produção é batido em **todas** as dimensões simultaneamente:

- **Qualidade:** perde de cinco dos sete candidatos, e é o único com falha crítica além do `gpt-4.1-nano`.
- **Preço:** `gpt-5.6-luna` (R$ 2,03) e `gpt-5.4-nano` (R$ 2,28) custam ~metade e acertam mais.
- **Latência:** é o **mais lento de todos** com 1.672 ms; o mais rápido faz 683 ms.
- **Consistência:** amplitude de 4,8 pp contra 0 pp de quatro candidatos.

## 4. Cache de prompt é o que torna tudo isso barato

O system prompt tem ~2.030 tokens estáticos e domina cada chamada. Medido:

| Modelo | prompt tokens | cached | input efetivo /1M |
| --- | --- | --- | --- |
| gpt-5.4-nano | 1.908 | 1.792 (94%) | ~US$ 0,031 |
| gpt-4.1-nano | 1.909 | 1.664 (87%) | ~US$ 0,035 |
| gpt-4o-mini | 1.909 | 1.024 (54%) | ~US$ 0,110 |

O cache **esquenta na primeira ou segunda chamada** e depois se mantém — a primeira medição
deu 0 e isso era cache frio, não ausência de cache. Consequência prática: o preço de tabela
superestima o custo real, e superestima mais para os modelos novos, que têm a tarifa de
cached input muito melhor (`gpt-5.4-nano` e `luna` a US$ 0,02 contra US$ 0,075 do atual).

## 5. Compatibilidade: o que impede alcançar cada modelo

`gpt-5.5`+ e a família `gpt-5-mini`/`gpt-5-nano` respondem **HTTP 400** a qualquer
`temperature` diferente de 1. O classificador enviava `temperature: 0` fixo, o que tornava
`luna`, `terra` e `sol` inalcançáveis. Resolvido por `supportsTemperatureZero()`, que envia o
parâmetro só a quem o aceita — `gpt-4o-mini` continua idêntico.

Medido antes de mudar: com o parâmetro omitido, esses modelos devolvem a mesma classificação
em cinco chamadas idênticas. A troca não foi determinismo por alcance.

## 6. Recomendação

**Trocar para `gpt-5.4-mini`.** Custa **+R$ 4,40 por clínica/mês** sobre o atual e entrega:

- 73,0% → **95,2%** no estrato A
- **zero** falha crítica e **zero** falha alta — o único candidato com as duas em zero
- 92,5% → **100%** de aderência às regras escritas do prompt
- amplitude 4,8 pp → **0 pp**
- 1.672 ms → 1.157 ms

A única falha dele é `acknowledgment ← patient_arrived` no caso `cheguei` com
`isClinicSegment: false`: o modelo lê que quem escreve "cheguei" chegou, e o rótulo esperado
vem de uma regra de segmento. É leitura defensável, severidade média, não erro de qualidade.

**Se custo for restrição dura, `gpt-5.6-luna` a R$ 2,03** — 48% mais barato que o atual, com
81,0%, zero crítica e 100% no estrato B. Não existe cenário em que ficar no `gpt-4o-mini`
seja a escolha certa.

**Não usar Sol nem Terra** para esta tarefa.

### Ressalva de tamanho de amostra

A diferença entre `gpt-5.4-mini` (20/21) e `gpt-4.1-mini` (19/21) é **um caso** — está dentro
do ruído e não sustenta uma ordenação forte entre os dois. O que a amostra sustenta com
folga: qualquer um dos cinco melhores bate o `gpt-4o-mini`, e `gpt-4.1-nano` é
substancialmente pior. Crescer o estrato A é o que permitiria separar o topo com confiança.

## 7. Consequência para os guards determinísticos

O `gpt-5.4-mini` acerta os 16 casos que motivaram guard, incluindo os 3 de manutenção fora de
catálogo e os 3 de chegada do paciente que **todos** os outros modelos erram.

Isso **não** autoriza retirar os guards de decisão baseada em dado. Manutenção fora de
catálogo é consulta ao catálogo, não julgamento linguístico: `detectUncataloguedMaintenanceInquiry`
resolve por `keyword ∈ mensagem` e `keyword ∉ catálogo`, deterministicamente e de graça. Guard
determinístico correto vence modelo probabilístico que concorda, porque o primeiro não tem
cauda de erro.

O que deve sair é a **duplicação no prompt**, não o guard. Ver a auditoria na seção 8.

## 8. Auditoria: decisões com dois donos

Levantamento motivado por uma pergunta do usuário sobre o caso de manutenção. Cinco decisões
têm implementação determinística **e** uma regra no prompt pedindo o mesmo da LLM, o que
contraria a §7.3 da spec mestre ("nenhum dado terá dois donos"):

| Decisão | Guard determinístico | Regra duplicada no prompt |
| --- | --- | --- |
| Ambiguidade entre variações | `detectAmbiguousTreatmentTerm` — casa nome e aliases e conta | 4 linhas: "corresponder a 2 OU MAIS procedimentos" |
| Manutenção fora de catálogo | `detectUncataloguedMaintenanceInquiry` | regra de `needs_human` |
| Identificação do tratamento | `resolveDirectTreatmentMention`, `resolveInformationalTreatmentTarget` | ~10 linhas de `identifiedTreatment` |
| Chegada do paciente | `detectPatientArrivalText` | 6 linhas de exemplos |
| Pergunta de horário | `isBusinessHoursQuestion`, `buildBusinessHoursAnswer` | regras de `general_question` |

Essas duplicações **não produzem resposta errada** — o guard roda depois da classificação e
sobrepõe. O dano é que ~100 das 120 linhas do prompt disputam atenção com os julgamentos que
só a LLM pode fazer, e isso foi medido: no estrato B o `gpt-4o-mini` classificou
`"quanto custa"` como `general_question`, frase que o prompt cita textualmente como
`price_inquiry`. Diluição de atenção, não hipótese.

**Previsão testável:** remover do prompt as regras que já têm guard deve elevar a acurácia nas
decisões restantes. É o mesmo formato do experimento de interferência da spec de design, mas
retirando ~50 linhas em vez de ~20, portanto com chance real de superar o piso de ruído.

### 8.1 Defeito ativo, que troca de modelo não resolve

`isSaturdayQuestionForOperatingClinic` está fixo em sábado (`hours.days.includes(6)`), e
`buildBusinessHoursAnswer` só trata `sabado` e `domingo` como pergunta de dia específico. O
comentário do próprio guard admite: *"Enquanto o parser não souber o resto da semana, o
sistema não afirma o que não sabe."*

Segunda a sexta não tem caminho determinístico. Pergunta de dia específico nesses dias cai no
genérico. Isso é **falta de dado**, não dilução de atenção — nenhum modelo inventa a escala da
semana da clínica. É a família do bug conhecido "Segunda → falso indisponível".

## 9. Custo do próprio benchmark

Oito modelos, ~1.100 chamadas: da ordem de **US$ 1** (cerca de R$ 5), contra um saldo de
US$ 6,20. O eval é barato o suficiente para ser rotina; o que custa dinheiro é a inferência
de produção, e é por isso que a decisão de modelo se mede em reais por clínica/mês, não em
centavos de experimento.
