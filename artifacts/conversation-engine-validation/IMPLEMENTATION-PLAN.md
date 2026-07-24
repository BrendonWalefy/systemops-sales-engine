# Plano de implementação incremental

Este plano começa somente após revisão do relatório. Nenhuma fase autoriza deploy automático.

## Gate 0 — Reconciliar a fonte de verdade

Objetivo: restaurar `develop` como integração real.

- decidir e executar back-merge seguro de `main` para `develop`;
- resolver conflitos em branch dedicada;
- rodar `npm run verify`;
- confirmar journal até `0085`;
- não misturar correções conversacionais nessa PR.

Rollback: reverter a PR de reconciliação; não reescrever histórico.

## PR 1 — Bugs concretos sem schema

Escopo:

- substituir as quatro strings literais por helper único;
- adicionar testes para todos os ramos de lookahead;
- atualizar documentação do fluxo de sender inline/outbox.

Não objetivos: engine V2, state model, refactor do orquestrador.

Rollback: revert simples.

## PR 2 — Caracterização e outcomes

Escopo:

- introduzir `TurnOutcome` no contrato do V1;
- mapear retornos existentes sem mudar inicialmente retry;
- persistir/logar razão de `replied:false`;
- adicionar testes para superseded, handoff, policy e falha.

Rollout: observabilidade primeiro; mudança de retry em PR posterior.

Rollback: ignorar o novo outcome e manter comportamento anterior.

## PR 3 — Reprodução e commit revisionado do pipeline

### 3A — Teste que falha

- harness integrado com dois jobs da mesma conversa;
- sender artificialmente bloqueado;
- provar leitura dupla do mesmo step;
- cobrir retry e outbox fora de ordem.

### 3B — Migration aditiva

- revision/turn ID;
- índice/idempotency key;
- backfill neutro;
- plano de rollback documentado.

### 3C — Commit atômico

- repository explícito para estado + turno + outbound;
- CAS por expected revision;
- sender deixa de ser o primeiro escritor do avanço.

Rollout: flag por organização; métricas de conflito CAS.

Rollback: dual-write/read com retorno ao caminho V1; manter colunas.

## PR 4 — Ingress comum

Escopo:

- payload canônico de inbound;
- Meta passa a persistir e enfileirar;
- paridade de idempotência e métricas com Z-API;
- manter adapter de provider fino.

Testes: duplicata, retry, tipo não suportado, clínica ausente, assinatura e ordering.

Rollback: flag `meta_durable_ingress`.

## PR 5 — Outbox lead-facing restante

Ordem:

1. envio manual do operador;
2. confirmação de depósito ao lead;
3. recovery manual.

Notificações internas ao staff devem usar categoria/política separada e podem vir depois.

Testes: texto, mídia, echo, falha, retry, idempotência, status visível na inbox.

Rollback: flag por categoria.

## PR 6 — Interface do engine e adaptador V1

Escopo:

- `ConversationEngine` e `TurnPlan`;
- adapter V1 preservando comportamento;
- `engineVersion` fixado por conversa;
- `conversationEngineMode` por organização;
- sem V2 ativo ainda.

Migration:

- colunas aditivas com default V1;
- índice para análise por engine;
- nenhuma remoção.

Testes: criação de conversa, conversa existente, mudança de flag, rollback.

## PR 7 — DecisionTrace e replay

Escopo:

- regras V1 nomeadas e trace sem alterar precedência;
- sanitização e retenção;
- dataset anonimizado de replay;
- golden tests;
- custo/latência por engine.

Rollback: desligar sink/sampling.

## PR 8 — V2 shadow puro

Escopo:

- V2 somente leitura;
- capabilities que tornam side effects impossíveis por tipo;
- sampling por organização;
- comparação V1/V2;
- painel/relatório de divergência.

Stop conditions:

- qualquer write operacional originado pelo shadow;
- exposição de PII no trace;
- custo/latência acima do teto;
- divergência grave sem explicação.

## PR 9 — Canary

- somente novas conversas;
- bucket determinístico;
- percentual inicial pequeno;
- clínicas explicitamente aprovadas;
- rollback por flag;
- revisão diária de duplicidade, handoff, erro, agenda, custo e conversão.

## Trilha paralela de configuração

PRs independentes:

1. remover `compileToClinicFields()` no-op e documentar owner atual;
2. lint/gate de comando de fluxo em `notes`;
3. ferramenta de reparo assistido para mídia órfã;
4. limpeza humana dos dados ativos de Ximendes/Vitalli;
5. unique index parcial de playbook ativo após auditoria global;
6. contração de colunas legadas somente após zero leituras e backfill completo.

Nenhum reparo de dado real deve ser automático.

## Verificação obrigatória por PR

```bash
npm run verify
```

Para alterações de agenda:

```bash
npm test -- \
  src/__tests__/SlotEngine.test.ts \
  src/__tests__/BookingDoubleBooking.test.ts \
  src/__tests__/SlotDayPreference.test.ts \
  src/__tests__/ClinicTimezone.test.ts
```

Também serão obrigatórios, conforme o PR:

- concorrência e CAS;
- idempotência de ingress/outbound;
- retries;
- replay;
- equivalência V1;
- migrations e rollback;
- QA manual com trace.

## Ordem de prioridade

1. reconciliar branches;
2. P1-05;
3. teste integrado P0-01;
4. TurnOutcome;
5. commit revisionado;
6. Meta durable ingress;
7. operator outbox;
8. interface V1/V2;
9. shadow;
10. canary.

## Ponto de parada

Após estes documentos e snapshots, parar para revisão do usuário. Não criar migrations, alterar comportamento, corrigir dados reais, enviar a branch ou abrir PR sem nova autorização.
