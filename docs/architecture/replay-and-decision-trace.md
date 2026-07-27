# Replay conversacional e Decision Trace

Este documento define a fronteira arquitetural do mecanismo recorrente de
validação conversacional. A implementação será incremental; a seção
“Estado atual” distingue o que já existe do que ainda precisa ser construído.

## Responsabilidades

### SystemOps

O SystemOps é o único dono de:

- execução do motor conversacional real;
- regras determinísticas e seus identificadores;
- configuração e playbook ativos por clínica;
- anonimização e criação do corpus;
- sandbox sem efeitos externos;
- `DecisionTrace` e invariantes de domínio.

### OMNIQA

O OMNIQA é um consumidor externo e independente. Ele pode:

- selecionar clínicas, datasets, modos e número de repetições;
- iniciar execuções pelo adapter seguro do SystemOps;
- agregar resultados determinísticos;
- executar LLM Judge e especialistas;
- comparar baseline e candidato;
- produzir relatórios HTML/JUnit.

O SystemOps nunca depende do OMNIQA. O OMNIQA nunca replica o orquestrador,
playbooks ou regras comerciais.

## Contratos versionados

Os contratos neutros vivem em:

- `src/application/replay/contracts.ts`;
- `src/core/observability/DecisionTrace.ts`.

Versões iniciais:

- `replay-scenario.v1`;
- `replay-dataset.v2`;
- `decision-trace.v1`;
- `replay-result.v1`;
- `replay-evaluation.v1`.

Mudanças incompatíveis exigem uma nova versão. Um cenário nunca pode conter ID
real de banco, telefone, nome, e-mail, URL de mídia ou texto não anonimizado.

## Correlação do turno

No fluxo assíncrono principal, `turnId` nasce do `inboundEventId` e acompanha:

```text
message.process
  -> ConversationOrchestrator
  -> ConversationOutboundPayload
  -> message.send
  -> SendMessageJobHandler
```

Payloads antigos continuam válidos porque `turnId` é opcional e o runtime usa o
ID operacional anterior como fallback de log.

## Captura

O sink padrão é `noop`. Para diagnóstico controlado:

```bash
DECISION_TRACE_MODE=structured_log
```

Esse modo registra somente metadados explicitamente fornecidos pelos call sites.
Não registrar corpo da mensagem, prompt, resposta, telefone ou nome em eventos
de trace.

O `InMemoryDecisionTraceSink` é o destino para testes e para o futuro runner de
replay. Falha de observabilidade nunca altera a decisão ou interrompe o
atendimento.

## Privacidade

`GET /api/e2e/production-conversations` foi desativado. O endpoint antigo
devolvia texto e IDs brutos de conversas reais e não deve ser reativado.

O exportador substituto deve:

1. rodar internamente e em modo read-only;
2. exigir allowlist explícita de clínicas;
3. anonimizar antes de gravar ou transmitir;
4. substituir IDs reais por hashes opacos;
5. remover URLs de mídia;
6. gerar manifesto, checksum e versão do dataset;
7. gravar artefatos fora do Git;
8. ter retenção e acesso restritos.

### Exportador local

O primeiro exportador read-only está disponível por:

```bash
npm run replay:export -- \
  --clinic <slug-da-clinica> \
  --dataset-version <versao-imutavel> \
  --out-dir <caminho-absoluto-fora-de-qualquer-repositorio-git> \
  --limit 50
```

Ele exige:

```bash
REPLAY_EXPORT_ALLOWED_CLINICS=slug-explicitamente-autorizado
REPLAY_EXPORT_HASH_KEY=chave-local-com-pelo-menos-32-caracteres
```

O export:

- consulta apenas tabelas necessárias em modo read-only;
- inclui a conversa intercalada inteira das conversas selecionadas;
- preserva offsets e tipo de mídia, sem URL;
- pseudonimiza IDs por HMAC;
- gera fingerprints de configuração e playbook;
- sanitiza padrões conhecidos de PII;
- grava com permissão `0600` e `flag=wx`, sem sobrescrever baseline;
- sempre nasce `needs_review`.

`needs_review` não pode ser entregue ao OMNIQA. Mesmo com detecção automática,
texto livre pode conter um identificador não reconhecido.

Gere uma visão Markdown privada para fazer a revisão cenário a cenário:

```bash
npm run replay:review -- \
  --input /caminho/corpus/clinica.baseline.needs-review.json \
  --output /caminho/corpus/clinica.baseline.review.md
```

O relatório inclui o checklist obrigatório e uma confirmação por cenário. Ele
também fica fora de Git, é criado com permissão `0600` e nunca sobrescreve um
arquivo existente.

### Aprovação assinada

A aprovação não é uma edição manual do JSON. Gere uma vez o par Ed25519 em um
diretório privado fora de qualquer repositório:

```bash
npm run replay:keys -- --out-dir /caminho/privado/replay-keys
```

Depois de revisar manualmente todos os textos e placeholders do arquivo
`needs-review`, aprove sem sobrescrever a origem:

```bash
npm run replay:approve -- \
  --input /caminho/corpus/clinica.baseline.needs-review.json \
  --output /caminho/corpus/clinica.baseline.approved.json \
  --private-key /caminho/privado/replay-keys/replay-approval-private.pem \
  --reviewer qa-owner \
  --confirm-reviewed YES
```

O arquivo aprovado contém digest da origem, identidade não pessoal do revisor,
data, ID da chave e assinatura do conteúdo inteiro. Alterar qualquer turno,
fingerprint ou metadado após a aprovação invalida a assinatura. O OMNIQA recebe
somente a chave pública confiável.

Os critérios para chamar uma execução de replay fiel estão em
[`replay-fidelity-contract.md`](replay-fidelity-contract.md).

## Estado atual

Implementado:

- contratos de cenário/resultado `v1` e dataset assinado `v2`;
- `turnId` entre ingresso, orquestrador, outbox e sender;
- sink noop, em memória e log estruturado opt-in;
- estágios iniciais de ingresso, configuração, planejamento, enqueue e entrega;
- bloqueio da exportação bruta;
- exportador read-only com allowlist, pseudonimização, sanitização e saída fora
  de Git em estado `needs_review`.
- geração local de chaves Ed25519 e aprovação humana assinada, sem sobrescrita.
- captura injetável de WhatsApp, TTS, storage e escritas de calendário, mantendo
  sender, persistência multiparte, follow-ups e avanço de pipeline reais;
- resolvedor de calendário injetável no orquestrador;
- trace de estado carregado, classificação, intenção final e estado antes/depois
  da entrega.
- rota opt-in `/api/e2e/replay/scenario` para `closed_loop`, que valida
  fingerprint, atravessa webhook e filas reais, devolve trace/efeitos/checks e
  remove todos os registros sintéticos ao terminar.
- reconciliação automática dos estreitos intervalos entre persistir inbound/
  outbox e enfileirar seus jobs, com contadores expostos no resultado dos
  workers.

### Sandbox de execução

A rota de cenário exige a autenticação E2E existente e também:

```bash
E2E_MODE=true
E2E_REPLAY_MODE=true
REPLAY_SANDBOX_DATABASE_HOST=<host-exato-do-branch-isolado>
REPLAY_PRODUCTION_DATABASE_HOST=<host-exato-de-producao>
```

Ela não existe fora do modo E2E, recusa Vercel Production, exige que o host
atual seja exatamente o sandbox declarado e diferente de produção, exige fila
vazia no início e compara os fingerprints do cenário com a clínica do banco.
Cada cenário usa contato sintético e limpa lead, conversa, mensagens, estados,
appointments, reservas, follow-ups, eventos, outbox, jobs e custos gerados.

O runner força a política de automação para `live` somente dentro desse sandbox,
inclusive quando o snapshot da clínica está em shadow/pausado. Isso testa o
comportamento que seria ativado sem alterar a configuração copiada. A entrega
continua atravessando o sender real, mas a boundary marcada como captura sandbox
substitui os provedores e registra os efeitos. Essa exceção não existe no runtime
online.

No runtime online, shadow é estritamente `observation-only`: registra inbound e
encerra antes de qualquer decisão ou efeito da IA. Áudios são transcritos para
preservar o corpus, sem autorizar resposta.

Clínicas com agenda interna usam a fotografia já presente no banco isolado.
Clínicas em `google_calendar` podem executar conversas que não consultem agenda;
qualquer leitura de disponibilidade falha com `calendar_snapshot_required` em
vez de chamar o Google real.

Ainda não implementado:

- fingerprint persistido no runtime do trace;
- identificação individual de cada override determinístico no trace;
- provisionamento automatizado do branch de banco e relógio controlável;
- fotografia assinada de disponibilidade para clínicas `google_calendar`;
- modos `historical_turn`, `counterfactual` e `concurrency`;
- baseline das clínicas e relatório comparativo.
