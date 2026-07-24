# ADR proposta — Coexistência segura do Conversation Engine V1/V2

Status: Proposta para revisão  
Data: 24/07/2026

## Contexto

O V1 está em produção e concentra decisão, estado e efeitos no `ConversationOrchestrator`. A auditoria confirmou riscos de concorrência, decisão implícita, fragmentação de ingress/outbound e ausência de outcome semântico. Também confirmou que um rewrite ou troca direta aumentaria o risco operacional.

O `shadowModeEnabled` existente não serve para comparar engines porque executa o motor e pode produzir efeitos, suprimindo apenas a entrega ao provider.

## Decisão proposta

Adotar coexistência incremental com estes contratos:

1. **V1 permanece disponível e é o default.**
2. **A versão é fixada na criação da conversa.** Uma conversa existente não muda de engine por alteração da organização.
3. **A organização possui um modo de rollout**, inicialmente:
   - `v1`
   - `v2_shadow`
   - `v2_canary`
   - `v2`
4. **V2 shadow é puro:** lê um snapshot autorizado, calcula decisão/trace e não grava estado operacional, não reserva agenda, não envia, não atualiza lead e não dispara notificação.
5. **Canary escolhe apenas novas conversas** por alocação determinística e estável.
6. **Rollback é por flag**, sem deploy e sem mudar a engine de conversas já iniciadas.
7. **Toda decisão de turno recebe `turnId` e outcome tipado.**
8. **Transições críticas usam revision/CAS** e são comprometidas junto à outbox.
9. **O sender confirma entrega; não decide estado de negócio pela primeira vez.**
10. **DecisionTrace é sanitizado**, versionado e amostrado; conteúdo sensível não é copiado indiscriminadamente.

## Contratos

```ts
type EngineVersion = "v1" | "v2";

type TurnOutcome =
  | "replied"
  | "superseded"
  | "no_reply_policy"
  | "handed_off"
  | "retryable_failure"
  | "terminal_failure";

interface ConversationEngine {
  evaluate(input: TurnSnapshot): Promise<TurnPlan>;
}

type TurnPlan = {
  turnId: string;
  engineVersion: EngineVersion;
  expectedStateRevision: number;
  response: ResponsePlan | null;
  transition: StateTransition | null;
  effects: DeclaredEffect[];
  outcome: TurnOutcome;
  trace: DecisionTrace;
};
```

No primeiro estágio, o adaptador V1 pode produzir esse envelope sem alterar as regras internas. Isso cria observabilidade e contrato antes de extrair comportamento.

## Persistência aditiva sugerida

- `organizations.conversation_engine_mode`
- `organizations.v2_canary_percent`
- `conversations.engine_version`
- `conversations.state_revision` ou store revisionado equivalente
- `conversation_turns` com `turn_id`, engine, outcome, snapshot/hash e timestamps
- `decision_traces` com versão de regra e payload sanitizado
- chave idempotente de outbound por `turn_id + part_index`

As migrations devem ser aditivas e com defaults compatíveis com V1. Nenhuma coluna antiga é removida durante rollout.

## Commit do turno

O repositório deve oferecer uma operação atômica:

```text
expected revision confere
  → grava nova revisão/transição
  → grava turn outcome
  → grava outbound commands idempotentes
  → commit
```

Se o driver não suportar uma transação interativa segura no ambiente usado, implementar a operação como statement SQL atômico/CTE dentro de um repository explícito.

## Shadow

`v2_shadow` recebe o mesmo snapshot lógico do V1, mas:

- não recebe repositories mutáveis;
- não executa delivery;
- não cria reserva;
- não grava state;
- não chama notificações;
- grava somente trace de comparação por um sink específico e seguro;
- possui sampling e orçamento de custo.

Comparações mínimas:

- intent/ação final;
- próximo estado;
- resposta semântica;
- mídia pretendida;
- necessidade de humano;
- agenda pretendida;
- latência e custo.

## Canary

- somente organizações explicitamente habilitadas;
- somente novas conversas;
- bucket estável por `conversationId`;
- percentual configurável;
- stop conditions automáticas;
- V1 continua disponível para rollback.

## Critérios de promoção

- zero duplicação crítica de pipeline na janela medida;
- zero envio sem idempotência nos caminhos incluídos;
- outcomes desconhecidos abaixo do limite acordado;
- divergências graves de shadow revisadas;
- latência e custo dentro do orçamento;
- testes, replay e QA manual aprovados;
- rollback ensaiado.

## Alternativas rejeitadas

### Rewrite do orquestrador

Rejeitado por risco, ausência de especificação completa e dificuldade de provar equivalência.

### Trocar `shadowModeEnabled` de significado

Rejeitado porque quebraria uma flag operacional existente e não isolaria efeitos.

### Mudar engine de conversas abertas

Rejeitado porque estado e decisões podem ter semânticas incompatíveis.

### Corrigir tudo no prompt

Rejeitado porque concorrência, idempotência, agenda e transição são regras determinísticas.

## Consequências

### Positivas

- rollout reversível;
- comparação mensurável;
- V1 preservado;
- decisões explicáveis;
- menor risco de duplicação e efeitos órfãos.

### Custos

- dual-run aumenta consumo de IA;
- novas tabelas/índices exigem retenção e privacidade;
- período de convivência aumenta complexidade;
- exige disciplina de versionamento e replay.

## Questões para decisão

1. Autorizar reconciliação `main` → `develop` antes dos patches?
2. Corrigir P1-05 isoladamente antes da iniciativa V2?
3. Priorizar o teste/reparo da corrida antes da interface de engine?
4. Quais clínicas podem participar de shadow e qual orçamento de custo?
5. Qual janela e quais thresholds definem rollback automático?
