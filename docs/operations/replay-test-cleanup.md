# Limpeza dos testes e ferramentas de conversa

Este registro evita que ferramentas antigas voltem a ser tratadas como prova de
qualidade do pipeline conversacional.

## Critério

Um teste ou driver de replay permanece ativo quando:

1. protege uma regra determinística atual; ou
2. executa o caminho real descrito no
   [`replay-fidelity-contract.md`](../architecture/replay-fidelity-contract.md);
3. isola banco, WhatsApp, Google Calendar, TTS e storage;
4. usa dados sanitizados, revisados e assinados;
5. produz asserções e evidências reproduzíveis.

Scripts que chamavam somente classificador/compositor, copiavam parte do
orquestrador, carregavam PII bruta ou dependiam de IDs fixos de uma clínica não
satisfazem esse contrato.

## Removido do SystemOps

| Artefato | Motivo | Substituto atual |
|---|---|---|
| `replay-conversas.ts`, `replay-regression.ts` | Pipeline parcial ou espelhado; podia aprovar uma resposta sem exercitar estado, fila, mídia, agendamento ou sender | `/api/e2e/replay/scenario` + OMNIQA |
| `replay-leads-reais-vitalli.ts`, `replay-wave2-guards.ts`, `replay-wave3-guards.ts`, `replay-wave4-guards.ts`, `replay-deposit-step.ts` | Drivers pontuais com clínica, instância, telefone e mídia hardcoded | Cenários genéricos do dataset assinado; regras continuam cobertas por Vitest |
| `replay-conversation-pendencies-19-07.ts` | Duplicava asserções já existentes em suítes Vitest | `ConversationWave2Guards`, `BusinessIntentCoercion`, `HumanReview`, `WhatsAppContactIdentity` e testes relacionados |
| `extract-replay-cases.ts`, `extract-vitalli-last-30.ts`, `extract-vitalli-last-hours.ts`, `query-vitalli-conversations.ts`, `audit-quality-vitalli.ts` | Exportação/análise pontual com risco de PII e sem gate de revisão | `npm run replay:export`, sanitização, allowlist e aprovação Ed25519 |
| `vitalli-last-30.json`, `vitalli-last-5h.json` | PII real versionada: nomes, telefones e mensagens | Datasets ficam fora do Git e só entram no OMNIQA depois da assinatura |

O `.gitignore` bloqueia novos arquivos `vitalli-last-*.json`. A exclusão acima
remove os dados do estado atual da branch, mas não reescreve o histórico Git.
Qualquer expurgo do histórico exige uma operação coordenada e autorização
explícita.

## Removido do OMNIQA

| Artefato | Motivo | Substituto atual |
|---|---|---|
| `bw-concierge-conversation.spec.ts` | Clínica inexistente, dados comerciais hardcoded, pipeline de simulação e 20 testes sempre ignorados | `approved-dataset-replay.spec.ts` |
| `ia-settings.spec.ts` | Cinco testes sempre ignorados contra painel que não existe mais | Recriar apenas quando o comportamento atual tiver contrato e seletores estáveis |
| `treatments.spec.ts` | Dois testes sempre ignorados após a UI migrar para lista somente leitura | Recriar apenas com seletores estáveis no produto |

Skips condicionais continuam válidos quando representam uma capacidade
deliberadamente opt-in, como credenciais, mutações em sandbox, LLM real ou
dataset aprovado. Uma suíte permanentemente ignorada não conta como cobertura.

## Mantido

- testes Vitest de regras, estados, agenda, webhook, idempotência, mídia,
  takeover humano, intenção e composição;
- testes de contrato do dataset e da assinatura;
- testes de bloqueio do sandbox;
- testes OMNIQA ativos de API e UI que executam quando o ambiente requerido
  está configurado;
- o E2E manual de webhook existente, pois ainda é referenciado pelo workflow
  manual. Ele é um smoke operacional, não o baseline conversacional fiel.

## Gate antes de remover mais

Nenhum teste ativo deve ser removido apenas por falhar ou exigir ambiente.
Primeiro é necessário demonstrar que:

- o requisito não existe mais; ou
- outra suíte cobre o mesmo risco pelo caminho correto; e
- o comando que referencia o arquivo foi atualizado e validado.
