# Plano de implementação incremental

Este plano começa somente após revisão do relatório. Nenhuma fase autoriza deploy automático.

## Gate 0 — Reconciliar a fonte de verdade — CONCLUÍDO

Objetivo: restaurar `develop` como integração real.

- PR #244 criada em branch dedicada;
- Verify, Migration staging e Vercel aprovados;
- fast-forward exato de `main@d8c0fd0` para `develop`;
- journal confirmado até `0085`;
- nenhuma correção conversacional misturada;
- divergência final `0 / 0`.

Rollback: reverter a PR de reconciliação; não reescrever histórico.

## PR 1 — Fechar vazamentos clinic-specific sem criar nova arquitetura

Escopo:

- remover Premium/Estratificada do orquestrador universal;
- resolver esclarecimento de mídia pelo tenant, tratamento e conteúdo/caption;
- separar pedido fora do horário de permissão para prometer exceção;
- fazer resposta de avaliação usar fato estruturado, sem inferir gratuidade de
  `depositEnabled`;
- tornar `Treatment.isAesthetic` o owner único em runtime;
- adicionar testes positivos e negativos entre Ximendes, Vitalli, NC Beauty e
  uma fixture não clínica.

Não objetivos: criar V2, migration ampla de policy ou refatorar todo o
orquestrador.

Rollback: commits independentes por vazamento; fallback conservador sem promessa
ou conteúdo não autorizado.

## PR 2 — Bugs concretos sem schema

Escopo:

- substituir as quatro strings literais por helper único;
- adicionar testes para todos os ramos de lookahead;
- atualizar documentação do fluxo de sender inline/outbox.

Não objetivos: engine V2, state model, refactor do orquestrador.

Rollback: revert simples.

## PR 3 — Caracterização e outcomes

Escopo:

- introduzir `TurnOutcome` no contrato do V1;
- mapear retornos existentes sem mudar inicialmente retry;
- persistir/logar razão de `replied:false`;
- adicionar testes para superseded, handoff, policy e falha.

Rollout: observabilidade primeiro; mudança de retry em PR posterior.

Rollback: ignorar o novo outcome e manter comportamento anterior.

## PR 4 — Reprodução e commit revisionado do pipeline

### 4A — Teste que falha

- harness integrado com dois jobs da mesma conversa;
- sender artificialmente bloqueado;
- provar leitura dupla do mesmo step;
- cobrir retry e outbox fora de ordem.

### 4B — Migration aditiva

- revision/turn ID;
- índice/idempotency key;
- backfill neutro;
- plano de rollback documentado.

### 4C — Commit atômico

- repository explícito para estado + turno + outbound;
- CAS por expected revision;
- sender deixa de ser o primeiro escritor do avanço.

Rollout: flag por organização; métricas de conflito CAS.

Rollback: dual-write/read com retorno ao caminho V1; manter colunas.

## PR 5 — Ingress comum

Escopo:

- payload canônico de inbound;
- Meta passa a persistir e enfileirar;
- paridade de idempotência e métricas com Z-API;
- manter adapter de provider fino.

Testes: duplicata, retry, tipo não suportado, clínica ausente, assinatura e ordering.

Rollback: flag `meta_durable_ingress`.

## PR 6 — Outbox lead-facing restante

Ordem:

1. envio manual do operador;
2. confirmação de depósito ao lead;
3. recovery manual.

Notificações internas ao staff devem usar categoria/política separada e podem vir depois.

Testes: texto, mídia, echo, falha, retry, idempotência, status visível na inbox.

Rollback: flag por categoria.

## PR 7 — TenantPolicy, capabilities e registry de aplicabilidade

Escopo:

- materializar um `TenantPolicySnapshot` validado;
- substituir `isClinicSegment` por capabilities coesas onde houver decisão;
- introduzir registry de regras com `id`, prioridade, `appliesTo` e trace;
- manter regras V1 e sua precedência, inicialmente sem alterar resposta;
- criar lint/teste arquitetural contra conteúdo clinic-specific no core.

Migration somente quando um dado realmente variar por tenant. Preferir campos
de tratamento já existentes e configuração tipada de módulo; não criar uma flag
por bug.

Testes:

- matriz regra × capability;
- mesma mensagem em tenants com policies diferentes;
- ausência de capability;
- compatibilidade de defaults;
- ativação rejeita combinações incompletas.

## PR 8 — Interface do engine e adaptador V1

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

## PR 9 — DecisionTrace e replay

Escopo:

- regras V1 nomeadas e trace sem alterar precedência;
- sanitização e retenção;
- dataset anonimizado de replay;
- golden tests;
- matriz de regressão cruzada das clínicas;
- custo/latência por engine.

Rollback: desligar sink/sampling.

## PR 10 — V2 shadow puro

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

## PR 11 — Canary

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

## Trilha paralela de segurança de dependências

PRs separados da arquitetura conversacional:

1. confirmar e remover `@auth/core` se continuar sem consumidor no build/runtime;
2. atualizar Next na linha corrigida, com smoke completo de proxy, autenticação,
   Server Actions, imagens, webhooks e preview;
3. atualizar Vitest e tooling;
4. reauditar transitivas restantes.

Não usar `npm audit fix --force` nem aceitar downgrade automático de
`drizzle-kit`.

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

1. reconciliação de branches — concluída;
2. vazamentos clinic-specific ISO-01 a ISO-04;
3. P1-05;
4. teste integrado P0-01;
5. TurnOutcome;
6. commit revisionado;
7. Meta durable ingress;
8. operator outbox;
9. TenantPolicy/capabilities;
10. interface V1/V2;
11. shadow;
12. canary.

## Ponto de parada

Após estes documentos e snapshots, parar para revisão do usuário. Não criar migrations, alterar comportamento, corrigir dados reais, enviar a branch ou abrir PR sem nova autorização.
