# Replay e Decision Trace

O replay valida o motor conversacional real em ambiente isolado. O Decision Trace explica decisões de produção sem armazenar conteúdo sensível.

## Decision Trace

O `turnId` nasce do `inboundEventId` e atravessa:

```text
message.process -> ConversationOrchestrator -> outbound_messages
-> message.send -> SendMessageJobHandler
```

O runtime persiste lotes de metadados sanitizados em `decision_traces` por 30 dias. Nunca inclui mensagem, prompt, resposta, telefone, nome, email ou URL. Falha de observabilidade nunca altera o atendimento.

Modos:

```bash
DECISION_TRACE_MODE=""               # banco sanitizado, padrão
DECISION_TRACE_MODE=structured_log   # logs efêmeros
DECISION_TRACE_MODE=off              # desativado
```

O endpoint autenticado e tenant-scoped de uma conversa permite inspecionar os estágios permitidos. O cron `decision-trace-cleanup` aplica retenção.

## Replay fiel

Uma execução fiel atravessa o mesmo caminho de produção:

```text
payload do canal -> webhook -> inbound_events -> jobs
-> orquestrador + state machine -> outbound_messages -> jobs
-> sender -> adapters de captura
```

Somente fronteiras externas são substituídas: WhatsApp, Google Calendar, storage e relógio. O sandbox nunca aponta para produção.

Critérios completos em [Contrato de fidelidade](replay-fidelity-contract.md).

## Dataset e privacidade

Datasets ficam fora do Git e seguem estes estados:

```text
export sanitizado -> needs_review -> revisão humana
-> aprovação Ed25519 -> approved -> replay sandbox
```

Um cenário não pode conter ID real, telefone, nome, email, credencial, URL de mídia ou texto não anonimizado. A sanitização automática não substitui revisão humana.

### Exportar

```bash
npm run replay:export -- \
  --clinic <slug-autorizado> \
  --dataset-version <versao-imutavel> \
  --out-dir <diretorio-absoluto-fora-do-git> \
  --limit 50
```

Variáveis locais obrigatórias:

```bash
REPLAY_EXPORT_ALLOWED_CLINICS=<slugs-autorizados>
REPLAY_EXPORT_HASH_KEY=<chave-com-32+-caracteres>
```

### Revisar e aprovar

```bash
npm run replay:review -- \
  --input /privado/dataset.needs-review.json \
  --output /privado/dataset.review.md

npm run replay:keys -- --out-dir /privado/replay-keys

npm run replay:approve -- \
  --input /privado/dataset.needs-review.json \
  --output /privado/dataset.approved.json \
  --private-key /privado/replay-keys/replay-approval-private.pem \
  --reviewer qa-owner \
  --confirm-reviewed YES
```

Alterar o dataset depois da aprovação invalida digest e assinatura.

### Executar

```bash
npm run replay:sandbox -- --output /privado/replay-sandbox.json
npm run replay:run -- \
  --dataset /privado/dataset.approved.json \
  --public-key /privado/replay-keys/replay-approval-public.pem \
  --endpoint http://127.0.0.1:3000/api/e2e/replay/scenario \
  --secret <e2e-secret> \
  --output /privado/replay-result.json

npm run replay:sandbox -- \
  --delete-branch <branch-id> \
  --confirm <branch-id>
```

O runner rejeita banco de produção, host não local por padrão, assinatura inválida e qualquer efeito externo não capturado.

## Responsabilidades

- SystemOps: runtime, regras, config, sanitização, sandbox, traces e invariantes.
- Ferramenta de QA externa: seleção, repetição, comparação, judges e relatórios.

O SystemOps não depende de um avaliador externo, e o avaliador não replica o orquestrador.

## Gate de qualidade

Uma execução deve registrar commit, versão do dataset, fingerprint de configuração, modo, modelos, transcript sanitizado, estados, traces, efeitos capturados e resultado terminal.

- invariantes determinísticas passam em 100%;
- qualidade de LLM é tratada como distribuição em múltiplas execuções;
- erro de infraestrutura/modelo nunca vira resultado verde;
- harness que pula webhook, banco, fila, state machine, outbox ou sender é teste parcial, não replay fiel.
