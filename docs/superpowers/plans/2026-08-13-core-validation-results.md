# Resultado: validação do core pelo histórico real

Data: 2026-08-13
Plano de origem: `2026-08-13-core-validation-plan.md` (Fases A e B)

## 1. O que foi executado

59 conversas reais dos três clientes, replayadas pelo pipeline inteiro em sandbox
isolado, comparadas turno a turno contra a resposta que o lead recebeu na época.

| Clínica | cenários | execuções íntegras |
| --- | --- | --- |
| Vitalli | 27 | 27/27 |
| Ximendes | 22 | 22/22 |
| NC Beauty | 10 | 10/10 |

**59/59 íntegras** — todos os checks de fidelidade verdes (turnos processados, nenhum
job morto ou reprocessado, agente respondeu, entrega observada, trace completo).

Recorte: cenários de até 10 turnos. Os longos (um tem 417 turnos) ficaram de fora por
custo de tempo, não por impedimento.

## 2. Lista priorizada

| n | código | severidade | dono provável |
| --- | --- | --- | --- |
| 18 | `handoff_regression` | alta | `prompt_or_model` |
| 10 | `price_omitted` | alta | `deterministic_code` |
| 10 | `media_omitted` | alta | `deterministic_code` |
| 5 | `price_value_divergence` | alta | `clinic_config` |
| 26 | `media_handled_by_operator` | baixa | `clinic_config` |

**69 divergências, 43 de severidade alta.** Cada uma carrega `turnId`, rastreável até a
conversa que a originou.

## 3. O que cada família significa

**`handoff_regression` (18).** O agente resolvia sozinho no histórico e o sistema de hoje
escala para humano. Metade dos casos passou por `response.fallback_applied` — o composer
produziu algo que reprovou na validação e caiu no fallback que escala. As ações no momento
do handoff: `general_question` (10), `price_inquiry` (4), `handoff_requested` (4).

**Ressalva que reduz o número:** os 4 com intent `handoff_requested` são escalação
correta — o lead pediu humano. O detector não deveria acusá-los. Sinal real: ~14.

**`price_omitted` (10).** O histórico cotou valor e o replay respondeu sem citar preço.
Aparece nas **três** clínicas independentemente, o que o torna o padrão mais consistente
da lista.

**`media_omitted` (10).** Anexo que a IA entregava e hoje não entrega.

**`price_value_divergence` (5).** Valor diferente do histórico — só na Ximendes.

**`media_handled_by_operator` (26).** Severidade baixa por desenho: quem entregava o anexo
era a recepcionista humana. É lacuna de biblioteca de mídia ou de passo de pipeline, não
regressão. Concentrado na Vitalli (18), onde 23 das 28 respostas com anexo eram do operador.

## 4. O que a execução mediu de latência

Turno completo, medido antes do fix do debounce: mediana **18,8s**, mínimo 15,4s. Debounce
**15,0s**; trabalho real, LLM incluso, mediana **3,8s**. O mínimo prova que o debounce era
piso. Depois do fix, cenário completo caiu de 19s para 3-4s.

## 5. Dois falsos achados descartados no caminho

Ficam registrados porque custaram tempo e podem se repetir.

**"A Ximendes tem bug de confiabilidade."** 0 de 22 execuções íntegras, 28 erros, zero
envios completados — contra 27/27 limpos na Vitalli. Parecia achado forte. Era **branch
Neon corrompida** pelo uso da tarde. Reexecutado em branch nova: 22/22, zero erros, 45
envios. Nada de errado com o sistema.

**"`media_omitted` 23 vezes na Ximendes."** Só 6 daquelas respostas históricas tinham anexo
enviado pela IA; 9 eram do operador e 8 mistas. O detector cobrava da IA um arquivo que uma
pessoa mandou na mão. Corrigido antes de virar relatório.

A lição comum: divergência medida em execução degradada não é divergência do sistema, e
verdade-base sem atribuição de autor não é verdade-base.

## 6. Próximos passos

1. **Corrigir a precisão do `handoff_regression`** — não acusar quando o intent é
   `handoff_requested`.
2. **Investigar `price_omitted`**, a família mais consistente e presente nas três clínicas.
3. **Rodar os cenários longos**, agora que o custo por turno caiu ~5x.
4. **Fase C (judge de prosa)** só depois disso: agora existe um número de divergências para
   dimensionar quantas são de prosa e justificam o instrumento.
