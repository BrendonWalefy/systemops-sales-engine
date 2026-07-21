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
| **P0** | 2 | Lead com várias mensagens sem resposta é tratado como primeiro contato | 8 de 36 openers (22%) | Corrigir a semântica: `isFirstMessage` deve exigir **1 única mensagem do lead** *e* nenhuma resposta. Com 2+ mensagens do lead, responder ao **conteúdo**, não abrir. | baixo | 🟢 |
| **P0** | 3 | 774 leads (98,5%) parados em `waiting_response` | §7 diagnóstico | Cobertura: varredura que responde/reengaja quem ficou sem resposta. É onde está a receita perdida. | médio | 🟡 |
| **P1** | 4 | Pedido explícito de agendamento cai em `general_question` | 3 de 7 (43%): *"Me agenda dia 8/8"* → horário de funcionamento | **Guard determinístico** de pré-classificação: frases de agendamento explícito ("me agenda", "podemos marcar", "quero agendar" + data) roteiam direto para o fluxo de slots, sem passar pela LLM. | baixo | 🟢 |
| **P1** | 5 | Pergunta de horário fora do expediente vira beco sem saída | 11 msgs / 5 convs, repetida em 4: *"posso ir após as 18h?"* → *"Seg-Sáb 8h-18h."* | Ao detectar horário **fora** da janela, nunca só informar o expediente: responder o limite **e ofertar os horários mais próximos**. Espelha o que a operadora faz. | baixo | 🟢 |
| **P1** | 6 | Lead já deu data **e** hora, sistema pede confirmação numérica | *"Dia 28/07 as 16h"* → *"responda apenas com o número"* | Quando data+hora do lead resolvem para **um único slot livre**, confirmar direto. Passo numérico só em ambiguidade. | médio | 🟡 |
| **P1** | 7 | Quantidade que continua pergunta de preço perde o assunto | **3 de 6** casos: *"Tem 13 lentes"* → `acknowledgment`; *"Das 20 lente"* → `general_question` | ✅ **Feito:** guard `isQuantityFollowupToPriceQuestion` portado do W4.2 e ligado à coerção de intent. **Premissa original revisada:** os "6 que viraram needs_human" eram mídia para avaliação — comportamento correto, não falha. Das 256 continuações curtas, 18% já herdam `price_inquiry` e 11% `confirm_slot`. | baixo | 🟢 |
| **P2** | 8 | Duas personas na mesma conversa | *"recepcionista virtual"* + *"Marina, assistente virtual"* | Unificar: o texto do opener deve derivar de `receptionistName`, nunca ter nome embutido. Ver `persona-config-drift`. | baixo | 🟢 |
| **P2** | 9 | Paciente em tratamento tratado como lead novo | áudio: *"como eu comecei a usar…"* → opener | Resolvido em grande parte por #1 e #2. Complemento: lead com agendamento ativo/histórico nunca recebe opener de primeiro contato. | baixo | 🟢 |
| **P2** | 10 | Preço + parcelamento na mesma frase não vira `price_inquiry` | 9 de 34 (26%) | Ampliar detecção para perguntas compostas ("valores **e** formas de pagamento"). | baixo | 🟢 |
| **P2** | 11 | Texto idêntico repetido na mesma conversa | 34 casos (máx. 2x) | Dedupe determinística: não reenviar bloco de conteúdo já enviado na mesma conversa. | médio | 🟡 |
| **P3** | 12 | 7% das respostas saem sem intent classificado | 64 de 867 | Instrumentar: registrar e alertar. Sem intent não há guard nem métrica. | baixo | 🟢 |
| **P3** | 13 | Sistema nunca registra "não entendi" | `consecutiveUnclearCount = 0` em 100% | Fazer o classificador emitir baixa confiança e acionar `needs_human` antes de responder errado com segurança. | médio | 🟡 |
| **P3** | 14 | Parcelamento classificado como `clinical_urgency` | 1 caso | Teste de regressão travando pagamento ≠ urgência. | trivial | 🟢 |
| **P1** | 15 | Default do debounce abaixo do gap real da rajada | 45 de 763 rajadas (6%) respondidas uma a uma; gap mediano da rajada = 10s vs default de 5s | ✅ **Feito:** default de plataforma extraído para `DEFAULT_MESSAGE_DEBOUNCE_MS` e elevado de 5s para 15s (~40% → ~67% de cobertura). Falta limpar o override de 7s da Vitalli para ela herdar o default. | trivial | 🟢 |
| **P2** | 16 | Guard de rajada não é observável | 8 openers escapam sem explicação | Instrumentar o guard antes de mexer nele: registrar descarte e passagem. | baixo | 🟢 |
| **P1** | 18 | Sábado respondido pela config, não pela agenda real | "Vocês atendem sábado?" hoje lê só `businessHours` | Consultar a disponibilidade real do dia antes de responder. Exige o SlotEngine no caminho da resposta determinística — **não implementado**. | médio | 🟡 |
| **P4** | 17 | Latência de 0–120s por dois saltos de cron | mediana 44s (Vitalli) / 15s (Ximendes); outlier de 539s | Disparo imediato pós-webhook. **Por último**: mexe em infra de processamento e melhora velocidade, não qualidade. | alto | 🔴 |

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
correta com endereço; *"Dia 03/07"* → horários daquela data; *"Sábado. Atende?"* → informa que não
há sábado **e oferece alternativas**. Nenhuma correção acima deve alterar esse caminho.

## Ressalvas

- Duas clínicas do mesmo segmento e público. Não generaliza para premium/luxo.
- M3 (truncamento pós-reset) foi identificado no código mas **não quantificado** — não sei quantos
  dos 28 openers restantes vêm dele. Investigar antes de mexer.
- Volumes pequenos (#6, #14) são sinal de padrão, não estatística.
- Nenhuma correção acima é verificável hoje: a atribuição de conversão (PR #210) começou a medir
  em 21/07 e ainda não tem linha de base.
