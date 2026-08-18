# Crescer o conjunto rotulado de intenção

Data: 2026-08-13
Status: aprovado, execução autorizada
Posição no programa: spec 1 de 4 — as outras três dependem da resolução de medição que esta entrega

## 1. Decisão

Levar o estrato A do dataset de eval de 21 para uma ordem de grandeza maior, colhendo do
corpus sanitizado que já existe e rotulando por passe assistido com revisão humana por
amostragem.

## 2. Por que isto vem primeiro

O harness de eval (PR #263) mede, mas com 21 casos **um caso vale 4,8 pontos percentuais** —
exatamente a amplitude de ruído entre rodadas. Depois da troca para `gpt-5.4-mini` (PR #265),
que acerta 20 dos 21, sobrou **um único caso de margem**.

Consequência concreta: o instrumento hoje detecta **regressão** e não detecta **melhoria**.
Toda conclusão da auditoria (spec 3) sobre remover regra do prompt seria "não piorou", nunca
"melhorou". Para uma auditoria que existe justamente para destravar a operação, isso é
resolução insuficiente.

Este é também o gargalo declarado na §13 da spec do harness para três frentes: separação de
responsabilidades do classificador, otimização automática de prompt e fine-tuning. Nenhuma é
avaliável com 21 casos.

## 3. O que já existe e não precisa ser construído

A infraestrutura de extração sanitizada está pronta e é cuidadosa:

| Peça | Função |
| --- | --- |
| `scripts/export-sanitized-replay-corpus.ts` | exporta `conversations`, `leads`, `messages` de uma clínica |
| `src/application/replay/build-sanitized-replay-corpus.ts` | monta o corpus |
| `src/application/replay/sanitize-replay-text.ts` | sanitiza texto |
| `src/application/replay/replay-export-policy.ts` | `assertClinicAllowedForReplayExport` (allowlist por env) e `assertReplayOutputOutsideGitRepository` |

Salvaguardas já implementadas que esta spec **preserva sem exceção**:

- `REPLAY_EXPORT_ALLOWED_CLINICS` — allowlist explícita; nenhuma clínica é exportável por omissão.
- `REPLAY_EXPORT_HASH_KEY` com mínimo de 32 caracteres — pseudonimização.
- O diretório de saída **precisa estar fora do repositório git**. Como o repo é público, essa
  checagem é o que impede dado de paciente virar commit.

Portanto esta spec não constrói extração nem sanitização. Ela constrói **rotulagem**.

## 4. Não-objetivos

- Não altera o exportador nem a política de sanitização.
- Não commita corpus bruto, nem sanitizado, em lugar algum do repositório.
- Não rotula qualidade de prosa — isso é a spec 2.
- Não altera código de produção.
- Não reativa tenant nenhum. Apenas histórico já gravado é lido.

## 5. Meta de tamanho e composição

**Alvo: 200 casos no estrato A**, com piso de 120 para a spec 3 poder começar.

Justificativa do número: com 200 casos, um caso vale 0,5 pp e a granularidade de ruído
esperada cai para a ordem de 1 a 2 pp, o que permite detectar diferença de 3 pp com
confiança — a faixa em que as remoções de regra provavelmente vivem. Com 120 casos um caso
vale 0,8 pp, suficiente para começar mas apertado.

Composição obrigatória, porque distribuição natural não cobre severidade crítica:

| Intent | Mínimo de casos | Motivo |
| --- | --- | --- |
| `stop_contact` | 10 | severidade crítica; zero casos reais hoje |
| `clinical_urgency` | 10 | severidade crítica; zero casos reais hoje |
| `patient_arrived` | 10 | severidade crítica; hoje 3 |
| `needs_human` | 15 | alta; e é onde vive a decisão mal alocada de manutenção |
| `confirm_slot`, `reject_slots` | 10 cada | alta; agenda errada |
| `price_inquiry`, `general_question`, `book_appointment` | 15 cada | volume real |
| `cancel_appointment`, `reschedule_appointment` | 8 cada | hoje sem exemplo citado no prompt e com 100% de erro medido |
| demais (`greeting`, `acknowledgment`, `farewell`, `check_availability`, `list_appointments`, `unclear`) | 5 cada | cobertura |

Casos que não couberem nas cotas continuam entrando: a cota é piso, não teto.

## 6. Como rotular

Três etapas, com o custo humano concentrado na terceira.

**Etapa 1 — colher candidatos.** Exportar o corpus sanitizado dos quatro tenants pausados e
extrair mensagens de lead com o contexto que o caso exige (`hasPendingSlotOffer`,
`isClinicSegment`, catálogo de tratamentos da clínica na época, histórico recente). Descartar
mensagem sem conteúdo (mídia sem legenda, string vazia).

**Etapa 2 — pré-rotular por concordância de modelos.** Classificar cada candidato com **dois
modelos diferentes** — `gpt-5.4-mini` e `gpt-4.1-mini`, os dois melhores medidos. Então:

- **Concordam** → rótulo provisório aceito, entra na fila de amostragem da etapa 3.
- **Discordam** → vai para revisão humana obrigatória. Discordância entre os dois melhores
  modelos é o sinal mais eficiente de caso difícil, e caso difícil é exatamente o que o
  dataset precisa.

Este passo é o que torna o custo humano viável: a revisão obrigatória cai sobre a fração
discordante, não sobre as 200.

**Etapa 3 — revisão humana.** O usuário revisa: (a) **todos** os discordantes; (b) uma
**amostra de 20%** dos concordantes, escolhida aleatoriamente com semente registrada. Se a
amostra revelar erro em mais de 5% dos concordantes, a pré-rotulagem é considerada não
confiável e a revisão se estende a 100%.

**Armadilha declarada:** pré-rotular com os mesmos modelos que serão avaliados enviesa o
dataset a favor deles — um caso que ambos erram do mesmo jeito entra com o rótulo errado e
some da medição. É precisamente por isso que a etapa 3 existe e por isso que a amostra dos
concordantes é obrigatória, não opcional. O viés não é eliminado; ele é **limitado e medido**
pela taxa de erro da amostra, que fica registrada no dataset.

## 7. Onde os casos ficam

Acrescentados a `evals/intent/cases.jsonl`, no formato já definido pela spec do harness, com
dois campos novos:

```json
{
  "id": "corpus-0142",
  "stratum": "incident",
  "message": "<texto sanitizado>",
  "expected": "stop_contact",
  "source": "corpus:<clinica-pseudonimizada>:<dataset-version>",
  "labeling": { "method": "model_agreement", "reviewed": true, "agreedModels": ["gpt-5.4-mini", "gpt-4.1-mini"] },
  "context": { "hasPendingSlotOffer": false, "isClinicSegment": true, "treatments": ["..."] },
  "history": []
}
```

- `source` referencia a clínica **pseudonimizada** e a versão do dataset, nunca nome real.
- `labeling.reviewed` distingue caso revisado por humano de caso aceito por concordância. O
  runner passa a poder filtrar por isso, e o relatório reporta as duas taxas separadas.

O texto que entra no `.jsonl` é o sanitizado. O corpus bruto permanece fora do repositório,
onde a política de exportação já o mantém.

## 8. Verificação

1. `npm run eval:intent` carrega o dataset ampliado sem erro de validação.
2. A cota mínima da §5 está satisfeita para cada intent, verificável por script.
3. A taxa de erro da amostra de concordantes está registrada e é menor que 5%.
4. A amplitude entre rodadas cai: com o dataset maior, medir 3 rodadas e confirmar que a
   amplitude do estrato A ficou abaixo de 2 pp. **Este é o gate real da spec** — o objetivo
   não é ter 200 linhas, é ter resolução.
5. Nenhum arquivo de corpus bruto ou sanitizado foi adicionado ao repositório: `git status`
   limpo fora de `evals/intent/cases.jsonl`.
6. A baseline é regravada com o dataset novo, porque as taxas antigas não são comparáveis com
   as novas.

## 9. Riscos

- **Viés de pré-rotulagem.** Tratado na §6; limitado, não eliminado. A taxa de erro da amostra
  é a medida honesta desse limite.
- **Deriva de catálogo.** O catálogo de tratamentos da clínica mudou ao longo do tempo, e o
  rótulo correto de uma mensagem depende do catálogo **da época**. Casos cujo catálogo não for
  recuperável com confiança são descartados em vez de rotulados por suposição.
- **Custo humano.** Se a fração discordante vier alta, a revisão cresce. Mitigação: começar
  pelo piso de 120 casos, medir a fração discordante real, e decidir sobre os 200 com o número
  na mão.
- **Privacidade.** O risco é assimétrico: o repo é público. A regra é que qualquer dúvida sobre
  um texto sanitizado resolve em favor de descartar o caso.

## 10. O que esta spec destrava

- Spec 3 (auditoria) passa a poder afirmar "melhorou", não só "não piorou".
- A pergunta de separação de responsabilidades do classificador, que o experimento de
  interferência não conseguiu responder por falta de resolução, volta a ser respondível.
- Otimização automática de prompt deixa de ser overfit garantido — ainda não recomendada, mas
  deixa de ser proibida por tamanho de amostra.
