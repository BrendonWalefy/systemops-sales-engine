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

## Estado atual

Implementado:

- contratos `v1`;
- `turnId` entre ingresso, orquestrador, outbox e sender;
- sink noop, em memória e log estruturado opt-in;
- estágios iniciais de ingresso, configuração, planejamento, enqueue e entrega;
- bloqueio da exportação bruta.

Ainda não implementado:

- exportador de corpus anonimizado;
- fingerprint completo de configuração/playbook;
- trace de estado antes/depois, classificador e cada override determinístico;
- sandbox com banco, relógio, calendário e canal isolados;
- modos `historical_turn`, `closed_loop`, `counterfactual` e `concurrency`;
- adapter SystemOps para OMNIQA;
- baseline das clínicas e relatório comparativo.
