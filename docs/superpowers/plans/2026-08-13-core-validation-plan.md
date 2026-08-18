# Plano: validar o core com o histórico real

Data: 2026-08-13
Objetivo: provar que o core conversacional funciona, replayando conversas reais dos quatro
clientes pelo pipeline inteiro, e produzir uma **lista priorizada de bugs** para corrigir
depois.

## 1. Por que este plano substitui o anterior

O programa de 4 specs escrito mais cedo hoje mirava o eval de **classificação**. A medição
mostrou que classificação deixou de ser o gargalo: `gpt-5.4-mini` acerta 20 de 21, com zero
falha crítica e zero alta.

E o eval de classificação mede **um** elo de sete:

| Elo | Medido hoje |
| --- | --- |
| 1. Classificação de intenção | sim |
| 2. Guards determinísticos | só com stub |
| 3. Execução da ação (agendar, cotar, mídia) | não |
| 4. Plano de resposta | não |
| 5. Prosa do composer | **não** |
| 6. Validator | não |
| 7. Entrega | não |

Os 21 casos são **mensagens isoladas** — `history: []` em todos os 21 — contra uma superfície
de 17 intenções, 11 estados de conversa, 34 tipos de `ActionResult`, 6 tipos de passo de
pipeline e 47 guards. A combinação intenção × estado sozinha já dá 187 situações.

**Replay de conversa completa exercita os sete elos de uma vez.** É o único caminho para a
pergunta "o core está bom?".

## 2. A ideia que torna isto barato: o histórico já contém a resposta certa

As conversas dos quatro clientes contêm **o que o agente realmente respondeu na época**, e o
desfecho real (agendou, sumiu, comprou). Isso é verdade-base que não precisa ser rotulada.

O replay roda a mensagem do lead pelo sistema de hoje e produz uma resposta nova. Comparar
com a histórica dá um A/B natural:

- **Divergência** onde o sistema de hoje faz diferente → candidato a bug ou a melhoria
- **Convergência** onde faz igual → nada a investigar
- Conversas que **deram certo** na época são o alvo a preservar; as que **deram errado** são
  o alvo a superar

Nenhum passo de rotulagem manual antes de ter a primeira lista.

## 3. O que já existe e o que falta

**Existe, pronto:**

| Peça | Função |
| --- | --- |
| `scripts/export-sanitized-replay-corpus.ts` | exporta conversas com sanitização e pseudonimização |
| `src/application/replay/replay-export-policy.ts` | allowlist por clínica, chave de 32+ chars, saída obrigatoriamente fora do git |
| `scripts/run-approved-replay-dataset.ts` | executa o dataset assinado |
| `replay-dataset-approval.ts` | aprovação por keypair |
| `replay-outbound-capture.ts`, `replay-calendar-capture.ts` | capturam o que o sistema tentou enviar e agendar |
| `evaluate-golden-expectations.ts` | checagens estruturais por cenário |
| `DecisionTrace` | estágios da decisão, por turno |

**Falta, e é o coração deste plano:**

`ReplayBugV1` está declarado em `contracts.ts` com `code`, `severity`, `title`,
`evidenceStages` e `probableOwner` (`clinic_config` · `playbook` · `deterministic_code` ·
`prompt_or_model` · `concurrency` · `delivery` · `dataset`) — e **nada o produz**.
`ReplayResultV1.bugs` é um campo sem produtor. O contrato foi desenhado; o detector não foi
implementado.

## 4. As quatro fases

### Fase A — Dataset a partir do histórico

Destravar a exportação, que exige duas variáveis hoje inexistentes:

- `REPLAY_EXPORT_ALLOWED_CLINICS` — allowlist explícita das clínicas exportáveis
- `REPLAY_EXPORT_HASH_KEY` — mínimo 32 caracteres, pseudonimização

O usuário autorizou usar os dados dos quatro clientes em 13/08. **Restrição que permanece:**
o corpus bruto fica **fora do repositório** (a política já obriga) e **nenhum texto literal
de paciente entra em arquivo versionado** — o repo é público e o sanitizador, mesmo depois do
PR #267, não alcança nome sem marcador, empregador nem bairro.

Seleção de cenários: começar por **40 conversas**, escolhidas para cobrir os 11 estados e os
desfechos reais (agendou, sumiu, pediu humano, reclamou de preço, urgência).

### Fase B — Detector de divergência

Implementar o produtor de `ReplayBugV1`. Para cada turno replayado, comparar:

| Dimensão | Sinal de bug |
| --- | --- |
| Intenção classificada | divergiu do que a ação histórica implica |
| Ação executada | agendou onde não agendou, ou vice-versa |
| Mídia enviada | anexo que a histórica não teve, ou ausência do que teve |
| Preço citado | valor divergente, ou preço onde não havia |
| Handoff | escalou onde resolveu, ou resolveu onde escalou |
| Estado final | terminou em estado diferente |
| Efeitos de calendário | criou, moveu ou cancelou diferente |

`probableOwner` sai da dimensão: preço divergente aponta `clinic_config` ou `playbook`;
mídia fora de hora aponta `deterministic_code`; intenção errada aponta `prompt_or_model`.

**Saída: uma lista, não uma correção.** O plano termina na lista priorizada; corrigir é
trabalho seguinte, com spec própria por família de bug.

### Fase C — Judge de prosa, só onde precisa

Muitas divergências terão as duas respostas plausíveis. Aí a comparação par a par decide qual
é melhor — a histórica ou a nova — com rubrica extraída das 10 conversas curadas de
`demo-conversation-scripts.ts`.

Detalhe de desenho já fechado: judge **par a par**, nunca nota absoluta; cada par julgado nos
dois sentidos, e veredito que muda ao inverter conta como empate; modelo de família diferente
da do composer, para não premiar o próprio texto. Ver
`docs/superpowers/specs/2026-08-13-prose-judge-design.md`.

### Fase D — Correção priorizada

A lista da Fase B, ordenada por severidade e por `probableOwner`. Bug de `clinic_config` se
corrige no painel; de `deterministic_code`, em código com teste; de `prompt_or_model`, com o
eval de classificação como trava.

## 5. Ordem e o que cada fase destrava

1. **A** sem B produz conversas replayadas que ninguém compara — inútil sozinha.
2. **B** sem A não tem o que comparar.
3. **C** só vale depois de B mostrar quantas divergências são de prosa.
4. **D** depende das três.

A e B andam juntas; C entra quando o volume de divergência de prosa justificar.

## 6. Critério de sucesso

O plano cumpriu quando existir:

- Um relatório com **N divergências, cada uma com severidade, estágio de evidência e dono
  provável**, rastreável até a conversa que a originou.
- A resposta à pergunta que hoje ninguém sabe: **quantos dos sete elos estão corretos** em
  conversa real.

Não é meta deste plano corrigir os bugs, nem atingir alguma taxa. A meta é **saber**.

## 7. O que este plano não faz, e por quê

- **Não cresce o dataset de classificação.** Com 20 de 21, o eval perdeu resolução para
  detectar melhoria; mais mensagens isoladas certificam melhor o elo que já está bom.
- **Não reativa clínica nenhuma.** Replay lê histórico e roda em sandbox; nenhuma mensagem
  sai para lead real.
- **Não coloca texto de paciente no repositório.** Ver Fase A.

## 8. Pré-requisito que já foi entregue

O PR #269 expõe a aba de conversas fechadas. Sem ela, conversa cujo lead vira `won` ou `lost`
some da interface — e as conversas geradas pelos replays sumiriam do mesmo jeito, deixando a
verificação cega. Vitalli tinha 1.024 de 1.028 conversas inalcançáveis.
