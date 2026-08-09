# Replay e Decision Trace

O replay valida o motor conversacional real em ambiente isolado. O Decision Trace explica decisões de produção sem armazenar conteúdo sensível.

## Hierarquia de evidência e handoff da Fase 2

```text
Unit/integration green != approved private replay green != Lab validation green.
```

Esses níveis não são intercambiáveis. Testes unitários e de integração exercem
contratos e seams no código; não provam que um dataset privado aprovado passou
no caminho fiel. Um replay privado só conta depois de usar um dataset
sanitizado, revisado por humano e assinado, no sandbox isolado. A validação de
Lab é a execução desse replay com banco isolado, configuração permitida e
adapters de captura, seguida da revisão operacional exigida. Nesta entrega,
nenhum replay de golden dataset privado aprovado foi executado e nenhuma
validação com banco de Lab foi executada.

Não há dataset privado criado ou aprovado a declarar nesta entrega. Quando os
datasets forem criados e aprovados, o Lab deverá executar — sem transformar as
famílias em alegações de cobertura já existente — as 12 famílias requeridas:

1. abertura genérica de anúncio de resina;
2. pergunta ambígua de preço;
3. pacote exato e parcelamento;
4. quantidade/arcada não padrão;
5. prova, cor e resultado;
6. foto para pré-avaliação;
7. data/horário explícito;
8. slot, sinal e confirmação;
9. promoção antiga;
10. manutenção, garantia ou caso atípico;
11. takeover e continuidade humana;
12. follow-up seguro.

Cada família precisa das variações aplicáveis de linguagem, áudio, rajada,
repetição, troca de assunto e retorno posterior. Os resultados devem manter
separados os modos `historical_turn`, `closed_loop`, `counterfactual` e
`concurrency` quando eles forem executados.

Antes de qualquer operação de produção ou de cliente, inclusive canal,
provider, Z-API, WhatsApp ou referência à Ximendes, todos estes stop gates são
obrigatórios:

1. credenciais prontas, incluindo confirmação de rotação de qualquer token
   exposto; token presente em screenshot ou histórico nunca é utilizável;
2. dataset privado sanitizado, revisado, assinado e aprovado;
3. banco isolado e gates de sandbox aprovados, com efeitos externos somente em
   adapters de captura;
4. revisão four-eyes do dataset, do resultado e das configurações usadas;
5. CI, preview e QA manual verdes antes de qualquer operação de produção ou
   cliente.

Não houve nesta entrega operação real de cliente, Z-API, provider, Ximendes ou
WhatsApp, nem deploy.

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

### Semântica golden, legado e respostas bloqueadas

`ReplayGoldenExpectationsV1` é opcional em `ReplayScenarioV1`. Um cenário com
expectations válidas é golden somente quando os checks de trace obrigatório e
proibido, estado final, efeitos de outbox e limite de escrita de agenda passam.
Qualquer check falso faz a execução falhar; erro de infraestrutura ou modelo
também não pode produzir verde. Cenários sem `expectations` continuam
executáveis e aparecem como legado para compatibilidade, mas nunca contam como
golden path.

No runtime, validação de resposta e validação de replay têm papéis distintos:

- Bloqueante antes da outbox: o validator rejeita a saída do composer que
  excede o plano autorizado; a saída rejeitada não é enviada.
- Fallback controlado: erro do composer ou rejeição do validator tenta cópia
  determinística baseada no `ActionResult`; essa cópia é validada de novo. Se
  ainda não for segura, segue cópia neutra com handoff e atenção humana.
- Bloqueante no Lab: dataset sem aprovação/assinatura, banco não isolado,
  fingerprint divergente, fila pendente, efeito externo real, trace incompleto
  ou expectation golden falha impedem resultado fiel verde.

O handoff operacional da Fase 2 não é autorização para executar replay
privado, usar Lab ou operar clientes. O rollback é por faixas de commits
independentes: response plan/validator, fallback/planner, trace, golden replay
e extração de montagem de resposta podem ser revertidos separadamente; não há
migration nesta fase.
