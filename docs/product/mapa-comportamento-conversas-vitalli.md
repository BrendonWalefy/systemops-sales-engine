# Mapa de comportamento conversacional — Vitalli + Ximendes (21/07/2026)

Levantamento sobre **todo o corpus de mensagens da IA em produção**: 855 conversas reais,
867 mensagens da IA (Ximendes 27/05→20/07, Vitalli 09/07→20/07).

Complementa [objetividade-conversacional-diagnostico.md](./objetividade-conversacional-diagnostico.md)
(estilo de resposta e conversão).

## 0. Nota de método — o que uma primeira versão deste documento errou

Registrado porque muda como os números devem ser lidos:

1. **Escopo pequeno demais.** A primeira análise cobriu 5 dias de *uma* clínica (326 msgs) e
   ignorou a Ximendes, que tem o histórico de IA mais longo. Corpus real: 867 msgs.
2. **Sem separar teste de produção.** Uma única conversa de teste interno concentra **196 msgs
   da IA — 18% do corpus bruto**. Ela inflava a contagem de repetição: o caso "card enviado 7x"
   era teste. **Em leads reais o máximo é 2x**, em 34 casos.
3. **Agregado no lugar de leitura.** Os erros abaixo marcados 🔴 só apareceram lendo conversa a
   conversa; nenhum deles surgiu na análise por regex/intent.

Todos os números desta versão excluem conversas de teste.

## 1. Distribuição de intents (contexto)

| Intent | % |
|---|---|
| `general_question` | 53,7% |
| `price_inquiry` | 30,5% |
| `book_appointment` | **1,3%** |

**Sem intent nenhum: 64 de 867 msgs (7%)** — a IA respondeu sem classificar.
E `consecutiveUnclearCount = 0` em todas as conversas: o sistema nunca registra "não entendi".

## 2. Tabela de erros — com caso real anexado

| # | Erro | Volume | Caso real |
|---|---|---|---|
| **E1** 🔴 | **Saudação de abertura reenviada no meio da conversa** | **38 de 67 aberturas (57%)** | LEAD: *"Tenho interesse em lentes de resina estratificadas na cor BL2. Gostaria de saber o valor"* → 🤖 *"Bom dia, Larissa Sales! Olá! Sou a recepcionista virtual da Ximendes…"* (repetido 2x com a mesma lead) |
| **E2** 🔴 | **Duas personas na mesma conversa** | mesma lead | 🤖 *"Sou a recepcionista virtual da Ximendes"* e depois 🤖 *"Sou a Marina, assistente virtual"* |
| **E3** 🔴 | **Paciente em tratamento tratado como lead novo** | áudio | LEAD (áudio): *"Oi doutor, bom dia. Como eu comecei a usar, né? …tem que esperar uns dias?"* → 🤖 *"Sou a Marina, assistente virtual… o que gostaria de ver hoje: valores, agendamento…?"* |
| **E4** 🔴 | **Negociação de horário respondida com expediente (beco sem saída)** | 11 msgs / 5 convs, **repetida em 4** | LEAD: *"dependendo do horário que vocês atendem, posso ir após as 18h na semana"* → 🤖 *"Nosso horário de atendimento é: Seg-Sáb 8h-18h."* |
| **E5** 🔴 | **Fricção: lead já deu data e hora, IA pede confirmação numérica** | — | LEAD: *"Dia 28/07 as 16h"* → 🤖 *"temos o seguinte horário: 1. Ter 28/07 às 16h. Responda apenas com o número."* |
| **E6** 🟠 | Pedido de agendamento cai em `general_question` | 3 de 7 (43%) | LEAD: *"Me agenda por gentileza dia 8/8 se tiver horário"* → 🤖 *"Nosso horário de atendimento é: Seg-Sáb 8h-18h."* → LEAD: *"Qual endereço?"* |
| **E7** 🟠 | Pergunta de preço não vira `price_inquiry` | 9 de 34 (26%) | *"Gostaria de saber valores e formas de pagamento"* |
| **E8** 🟠 | Respostas curtas de continuidade sem contexto | 23% das msgs; 6 viraram `needs_human` | *"Pode sim"*, *"Sim"*, *"Queria entender"* |
| **E9** 🟠 | Texto idêntico repetido na mesma conversa | 34 casos (máx. 2x) | 🤖 *"Oi, Aline! Estou aqui se precisar de mais informações"* + *"…se precisar de algo"* |
| **E10** 🟠 | Conversa termina com o lead falando por último | 54 de 209 (26%)¹ | — |
| **E11** 🟡 | Parcelamento classificado como `clinical_urgency` | 1 | — |

¹ limite superior — inclui encerramentos legítimos (lead que só agradece).

### O que a IA acerta (não mexer)

Vale registrar para não regredir: quando o intent é reconhecido, o agendamento funciona bem.
*"Terça dia 23 as 15h20"* → confirmação correta com endereço. *"Dia 03/07"* → ofereceu os horários
daquela data. *"Sábado. Atende?"* → informou que não há sábado **e ofereceu alternativas**.

## 3. A causa comum de E1, E3 e E6

Os três erros mais graves têm a mesma raiz: **a IA descarta o histórico e trata a mensagem como
primeiro contato**. Não é falta de informação — o preço, a agenda e o endereço estão todos
disponíveis. É perda de estado.

Isso é consistente com E8 (continuações sem contexto) e com os 7% sem intent: quando o
classificador não ancora a mensagem na conversa, o sistema cai no comportamento de abertura.

## 4. Prioridades revisadas

| # | Ação | Impacto | Risco | Cobre |
|---|---|---|---|---|
| 1 | **Nunca enviar a saudação de abertura se a conversa já tem histórico do lead** | 🔥 máximo | 🟢 baixo | E1, E3 |
| 2 | Intent de agendamento explícito não pode cair em `general_question` | 🔥 alto | 🟢 baixo | E6 |
| 3 | Pergunta sobre horário **fora** do expediente → oferecer alternativa, nunca só informar expediente | alto | 🟢 baixo | E4 |
| 4 | Data + hora completas do lead → confirmar direto, sem passo numérico | alto | 🟡 médio | E5 |
| 5 | Persona única por clínica (`receptionistName` vs texto do opener) | médio | 🟢 baixo | E2 |
| 6 | Contexto em respostas curtas de continuidade | médio | 🟢 baixo | E8 |
| 7 | Cobertura dos leads sem resposta | 🔥 alto | 🟢 baixo | E10 |

Os itens 1, 2, 3 e 6 são **guards determinísticos** — não tocam prompt, então não regridem o tom
ajustado nas waves 3/4/5.

## 5. O alvo: o que a clínica faz bem manualmente

1. Turno curto (41–120 chars) — faixa onde a IA quase não escreve (4% vs 30% do operador)
2. Preço direto + CTA: *"Placa de bruxismo tem o valor de R$ 700,00"* → *"Gostaria de agendar ?"*
3. Nunca encerra passivamente — sempre pergunta ou oferta concreta
4. Blocos técnicos enlatados em vez de explicação improvisada

## Ressalvas

- Duas clínicas, mesmo segmento e público. Não generaliza para premium/luxo.
- A IA operou de forma intermitente; o corpus de 867 msgs é pequeno diante das 855 conversas.
- E7/E8 vêm de heurística de regex sobre o texto do lead; E1–E6 e E9 foram lidos individualmente.
- Volumes pequenos (E5, E11) são **sinal de padrão a investigar**, não estatística.
