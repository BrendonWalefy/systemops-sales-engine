# Conversation Intelligence V2 — Cycle I Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** executar V1 e V2 sobre observações equivalentes, sem efeitos V2 em shadow, produzir evidência V1×V2 reproduzível e instalar um selector tenant-scoped cujo caminho `v2_internal` permaneça fail-closed.

**Architecture:** o runtime V1 expõe eventos plain-data das leituras que realmente consumiu; uma composição em `src/application/conversation-v2/` transforma esses eventos num snapshot imutável e alimenta o pipeline V2 até `Decision`. Escritas viram efeitos pretendidos tipados, resultados live são persistidos sem texto/PII somente depois do sender V1, e os runners offline aplicam o protocolo e os gates congelados antes de qualquer ativação.

**Tech Stack:** TypeScript 5.8, Next.js 16, Vitest 3.2, Zod 3.25, Drizzle/PostgreSQL, OpenAI adapter já existente, corpus JSONL e replay sandbox já existentes.

**Specs canônicas:** [`2026-08-15-conversation-intelligence-v2-design.md`](../specs/2026-08-15-conversation-intelligence-v2-design.md) e [`2026-08-16-conversation-intelligence-v2-cycle-i-design.md`](../specs/2026-08-16-conversation-intelligence-v2-cycle-i-design.md). Se este plano divergir, a spec ganha.

## Global Constraints

- Checkpoint de entrada: commit `99a852aa`; Cycles A–H e a propriedade `semantics(finalText) ⊆ semantics(validatedDraft) ⊆ semantics(authorizedPlan)` permanecem verdes.
- População primária: os **17 casos válidos** do manifesto `evals/understanding/cycle-f-dental.json`; nenhuma capability nova é adicionada para aumentar cobertura.
- Protocolo final: pares intercalados na ordem `V1_i → V2_i`, o mesmo conjunto, relógio e snapshot, com **`N = 6` por braço**. Par sem um dos braços é inválido, não removido.
- Casos estáveis formam a análise primária. A interseção com os D0-unstable `burst-0003`, `discount-0001`, `first-contact-0003`, `objection-0005` e `price-0003` é sensibilidade; interseção vazia continua vazia.
- O benchmark contextual D0 conserva seu denominador original de 64 casos comparáveis e sua regra: toda repetição favorece V2, delta médio ≥ 3,0 pontos percentuais, melhorias estáveis ≥ 2× regressões, zero regressão crítica em qualquer estrato e range V2 ≤ 1,6 com `N = 6`. Ele fica `not_measurable` fora dessa população e nunca é transportado para os 17 casos.
- Gate do recorte suportado: accuracy de `request` V2 ≥ V1 nos mesmos 17 casos, gate por eixo do Ciclo F verde, Decision/ActionResult exato onde mensurável e zero regressão crítica.
- Judge atual: `experimental_non_gating`, instabilidade **42,9%** > teto **25%**. GO qualitativo exige instrumento substituto que antes passe preferência pelo degradado ≥ 90%, order-flip < 25% e correlação vitória×comprimento < 0,3, ou dois revisores humanos calibrados usando `review-checklist.v2-calibrada`.
- Custo médio e latência p95 comparam o **turno completo** em replay/Lab com adapters equivalentes. O custo zero do H e a latência de componente em shadow são apenas diagnósticos. Ausência de replay privado aprovado deixa esse gate `not_measurable` e bloqueia ativação.
- V2 shadow usa somente leituras capturadas da execução V1. Leitura ausente retorna `shared_read_unavailable`; é proibido consultar DB, Google Calendar, provider de catálogo ou relógio vivo para completar o snapshot.
- V1 outcome/resposta/efeito não entra em Understanding, claim, decide, plano ou texto V2. É apenas o braço de controle do registro comparativo.
- Em shadow, `Capability.execute()` nunca é chamado para `Decision.kind === "execute"`; o resultado é `simulation_not_executed`, sem `ActionResult`, `AuthorizedResponsePlan` ou `FinalText` desse ramo.
- Nenhuma porta V2 shadow chama repository writer, `BookingService`, CalendarGateway, state machine, outbox, canal, CRM ou provider externo de efeito. Somente o sink de observabilidade, depois do resultado isolado, pode persistir o registro sanitizado.
- Registro live não contém mensagem, histórico, prompt, nome, telefone, email, URL, resposta, provider payload, DB id ou evidence ref em claro. Referências de correlação usam HMAC; texto sanitizado só entra no corpus commitado ou replay humano aprovado e assinado.
- Selector fechado: `v1 | v1_with_v2_shadow | v2_internal`, default `v1`, distinto do legado `shadowModeEnabled`. `disabled` e `observe` têm precedência e nunca executam shadow/V2.
- A implementação inicial mantém execução real `v2_internal` desabilitada, mesmo para tenant `isTest`; falta do shell produtivo completo ou de qualquer gate retorna a V1 antes de efeito V2 e registra razão fechada.
- Shadow só começa após V1 terminal e depois da tentativa de drenagem do sender. É awaited e best-effort; sua falha não muda acknowledgement, outbox, entrega ou resposta V1.
- Decisão `CI-V2-I-ADMISSION-DEADLINE-2026-08-16`: o budget da Task 5 é deadline de **admissão**, não garantia de retorno por T. Nenhuma operação relevante começa em/depois de `deadlineAt`; toda operação admitida antes dele é drenada até settlement explícito. Provider recebe cancelamento cooperativo por `AbortSignal`; Drizzle/Neon é prechecked antes do início e, uma vez iniciado, sempre awaited. Retorno após T é overrun medido e visível, nunca compliance estrito. Não usar `Promise.race`, abandonar Promise nem inferir cancelamento server-side de DB. Strict return-by-T exige outra fronteira de execução/cancelamento e fica fora deste plano.
- O core genérico continua sem imports de Domain Pack, provider, DB, calendário, config, V1 ou persistência de comparação. O Dental Pack continua sem importar provider específico.
- Sem novo event bus, framework de plugin, RAG, renderer probabilístico, capability Information/Media/Objection/Discount/FollowUp, cutover externo, remoção de V1 ou limpeza do Ciclo J.
- Mudança em `src/infrastructure/db/schema.ts` exige migration gerada por `npm run db:generate`; não editar SQL/snapshot gerado à mão.
- `npm run verify` deve ser executado exatamente assim, sem `dotenv -e .env.local`. Agenda: `npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts`.
- Cada tarefa começa com teste RED, termina GREEN, recebe revisão independente e vira um commit local pequeno. Nenhum push, merge ou deploy faz parte deste plano.

---

## Mapa de arquivos

| Responsabilidade | Arquivo proprietário |
| --- | --- |
| preparação e conclusão genéricas do turno | `src/conversation-core/turn-pipeline.ts` |
| snapshot de leituras e parser anti-TOCTOU | `src/application/conversation-v2/captured-turn-reads.ts` |
| efeito pretendido fechado do Dental Pack | `src/application/conversation-v2/dental-intended-effects.ts` |
| adapters somente-captura | `src/application/conversation-v2/dental-captured-read-adapters.ts` |
| execução V2 shadow sem writes | `src/application/conversation-v2/v2-shadow-runner.ts` |
| schemas live/eval e sanitização | `src/application/conversation-v2/comparison-record.ts` |
| protocolo `N = 6` e integridade pareada | `src/application/conversation-v2/comparison-protocol.ts` |
| folha humana cega e gate report | `src/application/conversation-v2/human-review.ts`, `src/application/conversation-v2/gate-report.ts` |
| seam V1 sem tipos V2 | `src/core/observability/V1TurnObservation.ts` |
| coleta turn-local da seam | `src/application/conversation-v2/v1-observation-collector.ts` |
| selector por tenant | `src/application/ports/conversation-engine-policy-reader.ts`, `src/application/conversation-v2/engine-selection.ts` |
| assembly produtivo e batch pós-sender | `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`, `src/application/conversation-v2/run-shadow-batch.ts` |
| persistência sanitizada | `src/application/ports/conversation-v2-comparison-sink.ts`, `src/infrastructure/repositories/drizzle-conversation-v2-comparison-sink.ts` |
| runner e artefatos offline | `scripts/eval-conversation-v2-cycle-i-bootstrap.ts`, `scripts/eval-conversation-v2-cycle-i.ts`, `evals/cycle-i/**` |

---

### Task 1: Separar preparação de conclusão sem alterar `runTurnPipeline`

**Files:**
- Modify: `src/conversation-core/turn-pipeline.ts`
- Create: `src/__tests__/TurnPipelinePreparation.test.ts`
- Modify: `src/__tests__/FixturePackPipeline.test.ts`

**Interfaces:**
- Consumes: `Capability<Request, Policy, ClaimPayload, Schema>`, `Decision`, `OutcomeSchema` e `runV2ResponsePipeline` existentes.
- Produces:

```ts
export type PreparedDecision = Readonly<{
  capabilityId: string;
  decision: Decision;
}>;

export type PreparedTurn<
  Request extends string,
  Policy extends object,
  ClaimPayload extends object,
  Schema extends OutcomeSchema,
> = Readonly<{
  capabilityIds: readonly string[];
  decisions: readonly PreparedDecision[];
}>;

export type PrepareTurnPipelineResult<...> =
  | { status: "suppressed"; reason: string }
  | { status: "needs_clarification" }
  | { status: "escalated"; reason: "capability_conflict"; capabilityIds: readonly string[] }
  | { status: "prepared"; prepared: PreparedTurn<...> };

export async function prepareTurnPipeline<...>(input: {
  gateInput: TurnGateInput;
  state: ConversationState;
  policy: StructuredPolicy<Policy>;
  now: Date;
  understand(): Promise<Understanding<Request>>;
  capabilities: readonly Capability<Request, Policy, ClaimPayload, Schema>[];
}): Promise<PrepareTurnPipelineResult<...>>;

export async function completeTurnPipeline<...>(input: {
  prepared: PreparedTurn<Request, Policy, ClaimPayload, Schema>;
  outcomeSchema: Schema;
  response: { style: ComposerStyle; composer: ResponseComposerPort<OutcomeTypeOf<Schema>> };
}): Promise<TurnPipelineResult<Schema>>;
```

`PreparedTurn` é produzido por registry privado `WeakSet`, profundamente congelado e contém internamente a capability correspondente; `completeTurnPipeline` rejeita instância forjada. Cada `Decision` é canonicalizada uma única vez para plain-data, rejeitando proxy/accessor/shape inválido; exatamente esse snapshot frozen aparece na projeção pública e é entregue a `Capability.execute`. Não há segunda leitura do objeto retornado por `decide()`.

- [ ] **Step 1: escrever os testes RED da seam**

Adicionar casos que: `prepareTurnPipeline` chama `understand`, `claim` e todos os `decide`, mas zero `execute`; a projeção e cada `Decision` estão congeladas; getter/proxy/alias não troca a decisão entre prepare e complete; uma preparação fabricada por cast falha com `unregistered prepared turn`; `completeTurnPipeline` executa cada capability exatamente uma vez e preserva o owner check; `runTurnPipeline` preserva os cinco estados e a resposta byte-idêntica do fixture-pack.

- [ ] **Step 2: confirmar RED**

Run: `npx vitest run src/__tests__/TurnPipelinePreparation.test.ts src/__tests__/FixturePackPipeline.test.ts`

Expected: FAIL por exports `prepareTurnPipeline`/`completeTurnPipeline` ausentes; os testes legados continuam compilando contra `runTurnPipeline`.

- [ ] **Step 3: extrair a implementação mínima**

Mover gate→understand→coordinate→decide para `prepareTurnPipeline`; mover execute→canonicalize→owner/count checks→plan→response para `completeTurnPipeline`; fazer `runTurnPipeline` apenas compor ambas. Copiar `Date` para o context antes de decidir, congelar arrays/projeções e registrar somente o objeto criado pelo módulo.

- [ ] **Step 4: confirmar GREEN e regressões do core**

Run: `npx vitest run src/__tests__/TurnPipelinePreparation.test.ts src/__tests__/FixturePackPipeline.test.ts src/__tests__/DentalOperationalPipeline.test.ts src/__tests__/V2ResponsePipeline.test.ts src/__tests__/arch/CoreImportBoundary.test.ts src/__tests__/arch/CoreDomainLexicon.test.ts src/__tests__/arch/CoordinatorBudget.test.ts`

Expected: PASS; `runTurnPipeline` mantém resultados existentes e nenhum novo import proibido entra no core.

- [ ] **Step 5: commit**

```bash
git add src/conversation-core/turn-pipeline.ts src/__tests__/TurnPipelinePreparation.test.ts src/__tests__/FixturePackPipeline.test.ts
git commit -m "refactor(conversation-v2): split turn preparation from effects"
```

---

### Task 2: Snapshots imutáveis, adapters capturados e executor shadow fail-closed

**Files:**
- Create: `src/application/conversation-v2/captured-turn-reads.ts`
- Create: `src/application/conversation-v2/dental-captured-read-adapters.ts`
- Create: `src/application/conversation-v2/dental-intended-effects.ts`
- Create: `src/application/conversation-v2/v2-shadow-runner.ts`
- Create: `src/__tests__/CapturedV2TurnReads.test.ts`
- Create: `src/__tests__/DentalShadowAdapters.test.ts`
- Create: `src/__tests__/V2ShadowRunner.test.ts`
- Create: `src/__tests__/arch/V2ShadowWriteBoundary.test.ts`

**Interfaces:**

```ts
export type CapturedRead<T> =
  | Readonly<{ status: "captured"; value: T }>
  | Readonly<{ status: "unavailable"; reason: "not_read_by_v1" | "unsupported_shape" }>;

export type CapturedV2TurnReads = Readonly<{
  version: "captured-v2-turn-reads.v1";
  now: string;
  gateInput: CapturedRead<Readonly<{ automationEnabled: boolean; duplicate: boolean; humanControlled: boolean; optedOut: boolean }>>;
  state: ConversationState;
  leadMessage: string;
  history: readonly Readonly<{ author: "lead" | "agent"; body: string }>[];
  policy: DentalPolicy;
  catalog: CapturedRead<readonly DentalService[]>;
  serviceResolutions: readonly Readonly<{ query: string; result: ServiceResolution }>[];
  slotSearches: readonly Readonly<{
    input: Readonly<{ service: string | null; date: string | null; period: string | null; minimumLeadTimeHours: number; now: string }>;
    result: DentalSlotSearchResult;
  }>[];
  offeredSlotResolutions: readonly Readonly<{ pendingStepId: string; ordinal: number | null; date: string | null; time: string | null; result: DentalSlot | null }>[];
  pendingAppointmentResolutions: readonly Readonly<{ pendingStepId: string; result: PendingDentalAppointment | null }>[];
}>;

export function parseCapturedV2TurnReads(input: unknown): CapturedV2TurnReads;
export function createDentalCapturedReadAdapters(reads: CapturedV2TurnReads): {
  catalogRead: DentalCatalogReadPort;
  schedulingRead: DentalSchedulingReadPort;
};

export type IntendedEffect = Readonly<{ kind: "would_have_executed"; capabilityId: string; payloadHash: string }> & (
  | Readonly<{ action: "book_slot"; payload: Readonly<{ slotRefHash: string }> }>
  | Readonly<{ action: "confirm_appointment"; payload: Readonly<{ appointmentRefHash: string }> }>
);

export function recordDentalIntendedEffect(input: {
  capabilityId: string;
  decision: Decision;
  hmacKey: string;
}): IntendedEffect | null;

export type V2ShadowResult =
  | Readonly<{ status: "evaluated"; actionResults: readonly ActionResult<typeof DENTAL_OUTCOME_SCHEMA>[]; response: CoreResponse }>
  | Readonly<{ status: "simulation_not_executed"; decisions: readonly PreparedDecision[]; intendedEffects: readonly IntendedEffect[] }>
  | Readonly<{ status: "unsupported"; reason: "unknown_effect" | "shared_read_unavailable" | "unsupported_request" }>
  | Readonly<{ status: "error"; errorName: string }>;

export class V2ShadowRunner {
  constructor(private readonly deps: {
    understand(reads: CapturedV2TurnReads): Promise<Understanding<DentalRequest>>;
    hmacKey: string;
    style: ComposerStyle;
  });
  run(reads: CapturedV2TurnReads): Promise<V2ShadowResult>;
}
```

- [ ] **Step 1: escrever RED para canonicalização adversarial**

Cobrir unknown key/prototype/accessor; getter que muda entre leituras; proxy que lança; `Date`, `Map`, função, símbolo, NaN/Infinity; aliases; mutação de input e nested arrays depois do parse. O snapshot aceito deve permanecer byte-idêntico e `Object.isFrozen` em toda a árvore.

- [ ] **Step 2: escrever RED para reads e writes**

Cobrir match exato de cada query; `gateInput.status = "unavailable"` retorna
`shared_read_unavailable` antes de chamar Understanding; consulta não capturada rejeita com o
mesmo status; nenhuma fallback production dependency existe no constructor;
`book-slot`/`confirm-appointment` produzem somente a variante fechada e HMAC; action desconhecida
é `unknown_effect`; decisão execute não chama `Capability.execute`, write port, composer ou
renderer; decisão só-read conclui normalmente.

- [ ] **Step 3: confirmar RED**

Run: `npx vitest run src/__tests__/CapturedV2TurnReads.test.ts src/__tests__/DentalShadowAdapters.test.ts src/__tests__/V2ShadowRunner.test.ts src/__tests__/arch/V2ShadowWriteBoundary.test.ts`

Expected: FAIL por módulos ausentes.

- [ ] **Step 4: implementar parser, lookups e runner mínimos**

Canonicalizar em nova árvore plain-data antes de validar; freeze bottom-up; resolver reads por chave canônica exata. O runner monta `createDentalPack` com adapters capturados e um write port que sempre lança, chama `prepareTurnPipeline`, intercepta qualquer execute antes de completion e somente chama `completeTurnPipeline` quando todas as decisões são não-write.

- [ ] **Step 5: confirmar GREEN e fronteiras**

Run: `npx vitest run src/__tests__/CapturedV2TurnReads.test.ts src/__tests__/DentalShadowAdapters.test.ts src/__tests__/V2ShadowRunner.test.ts src/__tests__/DentalSchedulingCapability.test.ts src/__tests__/DentalResponseLanguage.test.ts src/__tests__/arch/V2ShadowWriteBoundary.test.ts src/__tests__/arch/CoreImportBoundary.test.ts src/__tests__/arch/DentalPackBoundary.test.ts`

Expected: PASS; teste arquitetural recusa imports de DB/calendar/BookingService/outbox/channel em `src/application/conversation-v2/v2-shadow-runner.ts` e qualquer writer real no factory de adapters.

- [ ] **Step 6: commit**

```bash
git add src/application/conversation-v2 src/__tests__/CapturedV2TurnReads.test.ts src/__tests__/DentalShadowAdapters.test.ts src/__tests__/V2ShadowRunner.test.ts src/__tests__/arch/V2ShadowWriteBoundary.test.ts
git commit -m "feat(conversation-v2): add side-effect-free shadow execution"
```

---

### Task 3: Contratos de comparação, privacidade, protocolo humano e gate report

**Files:**
- Create: `src/application/conversation-v2/comparison-record.ts`
- Create: `src/application/conversation-v2/comparison-protocol.ts`
- Create: `src/application/conversation-v2/human-review.ts`
- Create: `src/application/conversation-v2/gate-report.ts`
- Create: `src/__tests__/ConversationV2ComparisonRecord.test.ts`
- Create: `src/__tests__/ConversationV2ComparisonProtocol.test.ts`
- Create: `src/__tests__/ConversationV2HumanReview.test.ts`
- Create: `src/__tests__/ConversationV2GateReport.test.ts`

**Interfaces:**

```ts
export const LIVE_COMPARISON_VERSION = "conversation-v2-live-comparison.v2" as const;
export const APPROVED_EVAL_VERSION = "conversation-v2-approved-eval.v1" as const;

export type HmacRef = `hmac:${string}`;
export type ModelCallSummary = Readonly<{
  modelId: string;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  estimatedCostMinor: number | null;
}>;
export type OutcomeStructuralSummary = Readonly<{
  capabilityId: "dental-catalog" | "dental-scheduling" | "dental-escalation";
  decisionKind: Decision["kind"];
  type: DentalOutcomeType;
  semanticClass: OutcomeSemanticClass;
}>;
export type EngineStructuralSummary = Readonly<{
  status: "observed" | "unsupported" | "error" | "no_safe_response" | "simulation_not_executed";
  understandingRequest: string | null;
  capabilityIds: readonly string[];
  decisionKinds: readonly Decision["kind"][];
  outcomes: readonly OutcomeStructuralSummary[];
  finalTextCharacters: number | null;
  finalTextDigest: HmacRef | null;
  fallbackSource: "draft" | "repair" | "fallback" | null;
  errorCode: "provider_error" | "shared_read_unavailable" | "unknown_effect" | "unsupported_request" | null;
  model: ModelCallSummary | null;
}>;
export type LiveComparisonRecord = Readonly<{
  version: typeof LIVE_COMPARISON_VERSION;
  turnRef: HmacRef;
  conversationRef: HmacRef | null;
  inputRef: HmacRef;
  occurredAt: string;
  commit: string;
  configDigest: HmacRef;
  datasetDigest: HmacRef | null;
  v1: EngineStructuralSummary;
  v2: EngineStructuralSummary;
  intendedEffects: readonly IntendedEffect[];
  divergenceCodes: readonly ("request_mismatch" | "subject_mismatch" | "outcome_mismatch" | "critical_regression")[];
}>;
export type ApprovedEvalRecord = Readonly<{
  version: typeof APPROVED_EVAL_VERSION;
  run: 1 | 2 | 3 | 4 | 5 | 6;
  caseId: string;
  arm: "v1" | "v2";
  snapshotDigest: HmacRef;
  outputText: string;
  source: Readonly<
    | { kind: "committed_corpus"; corpusDigest: HmacRef }
    | { kind: "signed_replay"; datasetDigest: HmacRef; approvalDigest: HmacRef }
  >;
}>;
export type ApprovedEvalPair = Readonly<{
  run: 1 | 2 | 3 | 4 | 5 | 6;
  caseId: string;
  pairDigest: HmacRef;
  snapshotDigest: HmacRef;
  v1: ApprovedEvalRecord & Readonly<{ arm: "v1" }>;
  v2: ApprovedEvalRecord & Readonly<{ arm: "v2" }>;
}>;

export function keyedRef(value: string, hmacKey: string): string;
export function parseLiveComparisonRecord(input: unknown, allowedModelIds: ReadonlySet<string>): LiveComparisonRecord;
export function parseApprovedEvalRecord(input: unknown): ApprovedEvalRecord;
export function pairApprovedEvalRecords(records: readonly ApprovedEvalRecord[]): readonly ApprovedEvalPair[];

export type ProtocolCase = Readonly<{ caseId: string; stratum: "stable_primary" | "d0_sensitivity"; critical: boolean }>;
export type ProtocolObservation = Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; arm: "v1" | "v2"; status: "observed" | "infrastructure_error"; payloadDigest: string }>;
export function createCycleIProtocol(input: { manifest: unknown; d0: unknown; corpusDigest: string; runs?: number }): Readonly<{ runs: 6; cases: readonly ProtocolCase[]; order: readonly Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; arm: "v1" | "v2" }>[] }>;
export function validateProtocolObservations(protocol: ReturnType<typeof createCycleIProtocol>, observations: readonly ProtocolObservation[]): void;

export function buildBlindHumanReviewSheet(input: { runDigest: string; pairs: readonly ApprovedEvalPair[] }): HumanReviewSheet;
export function scoreHumanReview(input: { sheet: HumanReviewSheet; reviewerA: unknown; reviewerB: unknown }): HumanReviewScore;

export const CYCLE_I_GATE_REPORT_VERSION = "conversation-v2-cycle-i-gate.v1" as const;
export function buildCycleIGateReport(input: CycleIGateInputs): CycleIGateReport;
export function parseCycleIGateReport(input: unknown): CycleIGateReport;
```

**Task 7 hardening amendment (2026-08-17, pre-activation):** the broad illustrative
`EngineStructuralSummary` above is superseded at the runtime boundary by exact discriminated
unions per arm and status. `comparable` requires an observed final V1 artifact;
`not_measurable` requires exact V1 `unavailable/final_response_unavailable` and zero divergence.
V2 never accepts `unavailable`; unsupported/error/simulation cannot carry outcome or final
semantics inconsistent with their status. The parser canonicalizes exact plain data before Zod.
The `.v1` wire value was never observed, persisted or activated and is rejected rather than
silently migrated. No V1×V2 result existed when this version was changed.

**Task 7 hardening amendment — round 3 (2026-08-17, pre-activation):** the emitted `.v2`
variants are relationally closed before their first live observation or persistence. Observed
and no-safe results carry one structured outcome identity per prepared decision, binding
`capabilityId`, `decisionKind`, concrete outcome `type` and canonical `semanticClass`; the
redundant structural arrays must have identical length and order, and duplicate capability
identities fail closed. `intendedEffects` exists only for `simulation_not_executed`, is nonempty,
maps one-to-one to `execute` decisions and has the same capability owner; every other status
requires an empty effect list. A non-null model summary always means at least one callback call.
Unsupported may retain that summary when rejection happened after the provider callback, while
duplicate/missing shared-read rejection before the callback keeps `model: null`. Exact root-key
inspection and conservative depth/node/array/object budgets precede snapshot traversal. This
completes the unpublished/unpersisted `.v2` contract rather than widening an activated wire
format; zero V1×V2 result and zero tenant/channel activation still existed at this decision.

**Task 7 hardening amendment — provenance closure (2026-08-17, pre-activation):** the Dental
Pack owns one frozen provenance registry for capability, prepared Decision kind, concrete execute
action when applicable, outcome type, semantic class and the existing subject/evidence
requirements. The same literal registry derives the TypeScript union and performs runtime
validation; `conversation-core` knows only generic contracts. Observed/no-safe records require
each prepared Decision to pair with its actual ActionResult owner and exact permitted tuple.
Simulation records carry typed concrete execute identities and align them one-to-one and in order
with intended effects. Forged, widened, cross-capability, cross-action and cross-decision tuples
fail closed. This amendment closes the last independent Task 7 finding before any `.v2`
observation, persistence or tenant/channel activation and does not reinterpret stored data.

`HmacRef` valida exatamente `^hmac:[a-f0-9]{64}$`. `modelId` não aceita texto arbitrário:
`parseLiveComparisonRecord` exige membership no `allowedModelIds` congelado pelo run manifest;
provider payload/id nunca tem campo no schema. Todos os demais strings live usam enum fechado,
digest, ISO datetime ou commit hex. O report contém critérios fechados `h_entailment`,
`shadow_no_effects`, `protocol_integrity`, `supported_understanding`, `supported_decision`,
`critical_regressions`, `qualitative`, `full_turn_cost`, `full_turn_p95`, `rollback`,
`observability`, `verification`, `adversarial_review`. Status fechado:
`pass | fail | not_measurable | pending_human_review`; só `pass` satisfaz critério bloqueante.

- [ ] **Step 1: escrever RED de privacidade/schema**

Testar rejeição de unknown keys, qualquer string live fora de enum/digest/ISO/commit/model allowlist e de qualquer chave que carregue `leadMessage`, `history`, `prompt`, `responseText`, provider payload/id, raw `turnId`, DB UUID ou evidence ref. Testar telefone/email/URL escondidos em cada campo, HMAC determinístico e distinto por key, deep freeze, versão inválida e mutations pós-parse. `ApprovedEvalRecord` aceita texto apenas com `source.kind` igual a `committed_corpus` ou `signed_replay` e metadata de aprovação válida.

- [ ] **Step 2: escrever RED de integridade do protocolo**

Testar exatamente 17 ids do manifesto, `runs === 6`, `V1_i` imediatamente antes de `V2_i`, digest imutável, braços/case sets iguais, duplicata, missing arm, run 5/7, drop depois de erro e mudança de stratum. A interseção D0 deve ser calculada antes da primeira observação.

- [ ] **Step 3: escrever RED de revisão humana e gates**

Testar unicidade de `(run, caseId)`, braços V1/V2 e `snapshotDigest` idêntico em `ApprovedEvalPair`; randomização determinística cega; dois revisores e quatro booleans completos; missing rating invalida o par; score mantém ties/disagreement/per-reviewer. Gate report rejeita população/denominador/applicability alterados, converte ausência de medida em `not_measurable`, mantém judge atual non-gating e jamais emite GO com qualquer blocking status diferente de `pass`.

- [ ] **Step 4: confirmar RED**

Run: `npx vitest run src/__tests__/ConversationV2ComparisonRecord.test.ts src/__tests__/ConversationV2ComparisonProtocol.test.ts src/__tests__/ConversationV2HumanReview.test.ts src/__tests__/ConversationV2GateReport.test.ts`

Expected: FAIL por módulos ausentes.

- [ ] **Step 5: implementar schemas fechados e funções puras**

Usar Zod `.strict()`, normalização plain-data, HMAC-SHA256 e freeze recursivo. Congelar na constante de applicability matrix os denominadores e regras da spec; não aceitar thresholds como argumento do CLI/report depois de existirem observations.

- [ ] **Step 6: confirmar GREEN**

Run: `npx vitest run src/__tests__/ConversationV2ComparisonRecord.test.ts src/__tests__/ConversationV2ComparisonProtocol.test.ts src/__tests__/ConversationV2HumanReview.test.ts src/__tests__/ConversationV2GateReport.test.ts src/__tests__/CorpusCaseSchema.test.ts src/__tests__/CorpusIndex.test.ts`

Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add src/application/conversation-v2/comparison-record.ts src/application/conversation-v2/comparison-protocol.ts src/application/conversation-v2/human-review.ts src/application/conversation-v2/gate-report.ts src/__tests__/ConversationV2ComparisonRecord.test.ts src/__tests__/ConversationV2ComparisonProtocol.test.ts src/__tests__/ConversationV2HumanReview.test.ts src/__tests__/ConversationV2GateReport.test.ts
git commit -m "feat(conversation-v2): freeze comparison and activation gates"
```

---

### Task 4: Adicionar seam observacional mínima à V1

**Files:**
- Create: `src/core/observability/V1TurnObservation.ts`
- Create: `src/application/conversation-v2/v1-observation-collector.ts`
- Modify: `src/core/pipeline/ConversationOrchestrator.ts`
- Modify: `src/application/jobs/process-message-job.ts`
- Create: `src/__tests__/V1TurnObservation.test.ts`
- Modify: `src/__tests__/ProcessMessageJob.test.ts`
- Create: `src/__tests__/arch/V1ObservationSeamBoundary.test.ts`

**Interfaces:**

```ts
export type V1TurnObservationEvent =
  | Readonly<{ kind: "turn_input"; turnId: string; now: string; leadMessage: string }>
  | Readonly<{ kind: "turn_gate_fact"; turnId: string; field: "automationEnabled" | "duplicate" | "humanControlled" | "optedOut"; value: boolean; source: "job_automation" | "v1_dedupe" | "v1_human_control" | "v1_opt_out" }>
  | Readonly<{ kind: "turn_context"; turnId: string; phase: string; pendingStepId: string | null; completedStepIds: readonly string[]; history: readonly Readonly<{ author: "lead" | "agent"; body: string }>[] }>
  | Readonly<{ kind: "tenant_snapshot"; turnId: string; configFingerprint: string; policy: Readonly<{ priceDisclosureEnabled: boolean; humanEscalationRequired: boolean; schedulingMinimumLeadTimeHours: number; schedulingRequiresEvaluationFirst: boolean }>; catalog: readonly Readonly<{ id: string; name: string; priceCents: number | null; priceDisclosable: boolean }>[] }>
  | Readonly<{ kind: "pending_slot_offer"; turnId: string; pendingStepId: string | null; slots: readonly Readonly<{ id: string; label: string; evidenceRef: string }>[] }>
  | Readonly<{ kind: "slot_search"; turnId: string; query: Readonly<{ service: string | null; date: string | null; period: string | null; minimumLeadTimeHours: number; now: string }>; service: Readonly<{ id: string; name: string }>; slots: readonly Readonly<{ id: string; label: string; evidenceRef: string }>[] }>
  | Readonly<{ kind: "v1_response_plan"; turnId: string; actionType: string; outcomeSummary: string; responseDigest: string; responseCharacters: number; latencyMs: number; modelId: string | null; inputTokens: number | null; outputTokens: number | null }>
  | Readonly<{ kind: "turn_terminal"; turnId: string; replied: boolean; reason: string | null }>;

export type V1TurnObservationSink = { record(event: V1TurnObservationEvent): void };

export class V1ObservationCollector implements V1TurnObservationSink {
  record(event: V1TurnObservationEvent): void;
  complete(turnId: string): CapturedV1Turn | null;
  drain(): readonly CapturedV1Turn[];
}
```

`CapturedV1Turn` é in-memory, profundamente congelado e separa `sharedReads` de `controlArm`. `buildCapturedV2TurnReads(turn)` usa somente `sharedReads`; tipos impedem acessar `controlArm` durante esse mapeamento.

`ConversationOrchestrator.handle` recebe `turnObservationSink?: V1TurnObservationSink` no input do
turno, não no constructor compartilhado. `ProcessMessageJobDependencies` recebe
`createTurnObservationSink?: (input: { turnId: string; clinicId: string }) =>
V1TurnObservationSink | undefined`; a factory é chamada no máximo uma vez por turno live.
Cada `turn_gate_fact` registra somente um valor que job/V1 efetivamente consumiu, no ponto da
leitura/decisão original, sem query nova. O collector só promove `gateInput.status = "captured"`
quando recebeu os quatro campos com a source correspondente; campo ausente permanece
`CapturedRead.status = "unavailable"`. Nunca preenche ausência como `false`.

- [ ] **Step 1: escrever RED da seam e não-contaminação**

Testar que observer omitido mantém V1 byte/comportamento; observer que lança é best-effort; eventos recebem clones congelados; mutation/alias do objeto V1 não altera o collector; cada gate fact preserva field/source e `buildCapturedV2TurnReads` deixa gate unavailable se qualquer campo faltar, sem inferir `false` do control arm; não aceita/transporta outcome, response digest ou `replied`; dois turns concorrentes não cruzam reads; finalização incompleta retorna null/fail-closed.

- [ ] **Step 2: escrever RED do lifecycle no job**

No `ProcessMessageJobHandler`, testar `turn_terminal` somente depois de `conversationHandler.handle` e `markInboundEventProcessed`; erro V1 não agenda shadow; `observe`/`disabled` não criam sink nem finalizam snapshot V2; `turnId` é o inboundEventId.

- [ ] **Step 3: confirmar RED**

Run: `npx vitest run src/__tests__/V1TurnObservation.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/arch/V1ObservationSeamBoundary.test.ts`

Expected: FAIL por contrato/sink ausentes.

- [ ] **Step 4: instrumentar somente pontos já resolvidos pela V1**

Adicionar `turnObservationSink?: V1TurnObservationSink` ao input turn-local de `handle`. Emitir
`turn_input` no início e cada `turn_gate_fact` apenas se/quando job/V1 consumir aquele valor, sem
I/O adicional nem tentativa de fabricar um snapshot completo; emitir `tenant_snapshot` depois de
config/catalog efetivamente carregados; `turn_context` depois de state/history;
`pending_slot_offer` e `slot_search` imediatamente após os reads reais; e `v1_response_plan`
dentro de `executeResponsePlan`. O sink copia/valida e nunca participa de branches. O job cria o
sink por factory apenas para automation `live`, passa-o no mesmo input e emite `turn_terminal`
depois do acknowledgement.

- [ ] **Step 5: travar a fronteira arquitetural**

O teste varre `src/core/observability/V1TurnObservation.ts` e `ConversationOrchestrator.ts`: zero import de `src/conversation-core`, `src/domain-packs`, `src/application/conversation-v2`; zero chamada a DB/provider nova atribuída à seam; eventos só plain-data. Conferir `git diff 99a852aa -- src/core` e rejeitar qualquer mudança de regra V1.

- [ ] **Step 6: confirmar GREEN e regressões V1**

Run: `npx vitest run src/__tests__/V1TurnObservation.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/ConversationResponsePlanner.test.ts src/__tests__/ConversationProcessingClaim.test.ts src/__tests__/arch/V1ObservationSeamBoundary.test.ts`

Expected: PASS e snapshots só aparecem em modo `live` quando o collector é injetado.

- [ ] **Step 7: commit**

```bash
git add src/core/observability/V1TurnObservation.ts src/application/conversation-v2/v1-observation-collector.ts src/core/pipeline/ConversationOrchestrator.ts src/application/jobs/process-message-job.ts src/__tests__/V1TurnObservation.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/arch/V1ObservationSeamBoundary.test.ts
git commit -m "feat(conversation-v2): expose immutable V1 turn observations"
```

---

### Task 5: Selector tenant-scoped, persistência sanitizada e wiring pós-sender

**Emenda datada de 2026-08-16.** A implementação anterior recebeu QUALITY PASS; o único blocker
remanescente era a promessa semanticamente impossível de strict return-by-T junto de zero
trabalho abandonado e zero mutação pós-retorno nas portas in-process atuais. Neon HTTP
`AbortSignal` não prova ausência de commit server-side. A Task 5 passa a ser aceita pelo contrato
de admission deadline + mandatory drain da decisão
`CI-V2-I-ADMISSION-DEADLINE-2026-08-16`, sem relaxar nenhum gate de autoridade, tenant, sender,
single-use, write isolation, rollback, privacidade ou observabilidade. A arquitetura futura para
strict return-by-T não será construída nesta task.

**Files:**
- Modify: `src/infrastructure/db/schema.ts`
- Create generated: `drizzle/0099_*.sql`
- Create generated: `drizzle/meta/0099_snapshot.json`
- Modify generated: `drizzle/meta/_journal.json`
- Create: `src/application/ports/conversation-engine-policy-reader.ts`
- Create: `src/application/ports/conversation-v2-comparison-sink.ts`
- Create: `src/application/conversation-v2/engine-selection.ts`
- Create: `src/application/conversation-v2/activation-approval.ts`
- Create: `src/application/conversation-v2/run-shadow-batch.ts`
- Create: `src/infrastructure/repositories/drizzle-conversation-engine-policy-reader.ts`
- Create: `src/infrastructure/repositories/drizzle-conversation-v2-comparison-sink.ts`
- Create: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Modify: `src/app/api/cron/message-worker/route.ts`
- Modify: `src/application/use-cases/clinics/reset-clinic-data.ts`
- Modify: `src/infrastructure/repositories/drizzle-clinic-reset-repository.ts`
- Create: `src/__tests__/ConversationV2EngineSelection.test.ts`
- Create: `src/__tests__/ConversationV2ActivationApproval.test.ts`
- Create: `src/__tests__/ConversationV2ShadowBatch.test.ts`
- Create: `src/__tests__/DrizzleConversationV2Policy.test.ts`
- Create: `src/__tests__/MessageWorkerV2Composition.test.ts`

**Interfaces:**

```ts
export const CONVERSATION_ENGINES = ["v1", "v1_with_v2_shadow", "v2_internal"] as const;
export type ConversationEngine = typeof CONVERSATION_ENGINES[number];
export type ConversationEnginePolicy = Readonly<{ clinicId: string; engine: ConversationEngine; isTest: boolean }>;
export type ConversationEnginePolicyReader = { getConversationEnginePolicy(clinicId: string): Promise<ConversationEnginePolicy> };

export type EffectiveConversationEngine =
  | Readonly<{ route: "v1"; shadow: false; reason: "configured_v1" | "automation_not_live" | "v2_internal_runtime_unavailable" | "activation_gate_missing" }>
  | Readonly<{ route: "v1"; shadow: true; reason: "configured_shadow" }>;

export function resolveConversationEngine(input: { automationMode: ClinicAutomationMode; policy: ConversationEnginePolicy; approval: InternalV2ActivationApproval | null }): EffectiveConversationEngine;

export type ConversationV2ComparisonSink = { append(record: LiveComparisonRecord): Promise<void> };
export type SenderDrainAttempted = Readonly<{ outcome: "completed" | "failed_handled"; occurredAt: string }>;
export function recordSenderDrainAttempt(input: { outcome: "completed" | "failed_handled"; occurredAt: string }): SenderDrainAttempted;
export async function runConversationV2ShadowBatch(input: { senderBarrier: SenderDrainAttempted; turns: readonly CapturedV1Turn[]; policyReader: ConversationEnginePolicyReader; runner: V2ShadowRunner; sink: ConversationV2ComparisonSink; maxTurns: number; deadlineMs: number; now(): number }): Promise<ShadowBatchSummary>;
```

`SenderDrainAttempted` é criado e registrado por factory privada somente depois que o `await` da
tentativa de `drainMessageSendQueue` terminou, com sucesso ou erro já tratado. O batch rejeita
cast/objeto forjado. O token prova ordering da tentativa do lote; não afirma entrega individual.

`ShadowBatchSummary` é frozen e registra: instante de deadline de admissão, se/quando a admissão
fechou, instante de retorno, overrun medido e contagem fechada das operações admitidas,
concluídas, falhas, pedidos de abort, cancelamentos cooperativos confirmados e operações ainda
ativas (que deve ser zero). Fechamento causado por T registra `admissionClosedAt = deadlineAt`.
Esses fatos não contêm IDs crus ou PII. A maior amostra válida do relógio é preservada como
evidência mínima de overrun; uma amostra posterior não finita ou regressiva fecha admissão/falha
conservadoramente e jamais apaga overrun provado. O summary é criado somente depois do drain;
portanto nenhuma escrita pode ser despachada depois dele. Exception, resultado malformado ou
captured read ausente só vira comparison record quando a própria escrita no sink foi admitida
antes de T; se a admissão fecha antes do sink, existe apenas no summary em memória e zero append
é iniciado.

Schema: enum PostgreSQL `conversation_engine`; coluna `organizations.conversation_engine NOT NULL DEFAULT 'v1'`; tabela `conversation_v2_comparisons` com `turn_ref` PK HMAC, `organization_id` FK cascade, `record` JSONB, `occurred_at`, `expires_at`, `created_at`, índices tenant/time e expiry. Retenção: 30 dias. Nenhum texto/PII tem coluna própria.

- [ ] **Step 1: escrever RED do selector e aprovação**

Cobrir todas as combinações automation×engine×isTest. `observe`/`disabled` sempre V1 sem shadow; `v1` default; `v1_with_v2_shadow` somente automation live; `v2_internal` em tenant não-test, relatório ausente, digest/build divergente ou objeto forjado retorna V1. Mesmo aprovação válida retorna `v2_internal_runtime_unavailable` nesta implementação.

- [ ] **Step 2: implementar regra pura e reader port**

`parseInternalV2ActivationApproval(report, expected)` só aceita `CycleIGateReport` registrado, frozen, com todos blocking gates PASS e commit/digests exatos; marca via registry privado. Não criar switch que alcance V2 live.

- [ ] **Step 3: adicionar schema e gerar migration**

Modificar somente `schema.ts`, então executar: `npm run db:generate`.

Expected: migration `0099_*`, snapshot `0099_snapshot.json` e journal gerados. Inspecionar o SQL: só enum, coluna com default e tabela/índices/FKs esperados; nenhuma mudança/destruição alheia.

- [ ] **Step 4: escrever RED de persistência/purge**

Testar reader tenant-scoped/default, sink chamando `parseLiveComparisonRecord` antes do insert, expiry 30 dias, falha best-effort, e reset/purge removendo comparison rows. Run: `npx vitest run src/__tests__/ConversationV2EngineSelection.test.ts src/__tests__/ConversationV2ActivationApproval.test.ts src/__tests__/DrizzleConversationV2Policy.test.ts`.

Expected: FAIL por adapters ausentes.

- [ ] **Step 5: escrever RED do batch e composition root**

Testar que o batch rejeita ausência/cast de `SenderDrainAttempted`, só começa com token criado após uma promise-sentinel do sender, e aceita `completed` ou `failed_handled` sem confundir tentativa com entrega. Cobrir lote vazio e processamento V1 concorrente; o batch é awaited, respeita `maxTurns` e a deadline de admissão, e uma falha V2/sink não altera summary V1. Provar por thunks que nenhuma policy read, avaliação, sink write ou operação relevante começa em/depois de `deadlineAt`; provider cancelável recebe pedido de abort, mas só incrementa cancelamento cooperativo quando o adapter confirma o erro tipado; cada operação admitida é observada e drenada antes do retorno; zero Promise fica órfã; sink/DB write não começa depois do fechamento da admissão nem depois da criação do summary; fechamento antes do sink produz zero append e mantém o resultado somente no summary; operação DB não cancelável admitida pode terminar após T, mas incrementa overrun em vez de strict compliance; uma amostra válida além de T continua provando overrun mesmo se a amostra de retorno for `NaN` ou regressiva. Nunca roda para `observe`, `disabled`, `v1` ou `v2_internal`; resolve policy uma vez por `clinicId`/turn sem cache cross-tenant. Teste estático confirma que route não reutiliza `shadowModeEnabled` como selector e não contém lógica de domínio.

- [ ] **Step 6: implementar adapters e wiring mínimo**

O route constrói collector e orchestrator, drena V1, aguarda a tentativa do sender existente,
trata o resultado, cria `SenderDrainAttempted` e somente então chama
`runConversationV2ShadowBatch`. `createConversationV2Runtime` instancia OpenAI Understanding,
deterministic composer, collector, policy reader e comparison sink; ausência de
`OPENAI_API_KEY` torna shadow `error` sem afetar V1. Não adicionar chamada a V2 dentro do core V1
nem fire-and-forget. Implementar admission controller único: precheck imediatamente antes de cada
thunk; `AbortSignal` apenas no provider, separando pedido de abort de acknowledgement cooperativo;
toda Promise iniciada registrada e awaited; summary somente após o drain, com overrun e fatos de
admissão congelados. Não usar `Promise.race`.

- [ ] **Step 7: confirmar GREEN, schema e purge**

Run: `npx vitest run src/__tests__/ConversationV2EngineSelection.test.ts src/__tests__/ConversationV2ActivationApproval.test.ts src/__tests__/ConversationV2ShadowBatch.test.ts src/__tests__/DrizzleConversationV2Policy.test.ts src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/ProcessMessageJob.test.ts`

Run: `npm run db:check`

Run only against the dedicated test env if `.env.test.local` is configured: `npm run test:db`. Nunca carregar `.env.local` para teste/migration apply.

Expected: PASS; migration metadata consistente; `v2_internal` não executável; zero operação
ativa no retorno, nenhuma nova admissão após T e todo retorno após T explicitamente contado como
overrun.

- [ ] **Step 8: commit schema/migration separadamente**

```bash
git add src/infrastructure/db/schema.ts drizzle/0099_*.sql drizzle/meta/0099_snapshot.json drizzle/meta/_journal.json src/application/use-cases/clinics/reset-clinic-data.ts src/infrastructure/repositories/drizzle-clinic-reset-repository.ts
git commit -m "feat(conversation-v2): persist tenant engine selection and shadow traces"
```

- [ ] **Step 9: commit wiring e testes**

```bash
git add src/application/ports/conversation-engine-policy-reader.ts src/application/ports/conversation-v2-comparison-sink.ts src/application/conversation-v2/engine-selection.ts src/application/conversation-v2/activation-approval.ts src/application/conversation-v2/run-shadow-batch.ts src/infrastructure/repositories/drizzle-conversation-engine-policy-reader.ts src/infrastructure/repositories/drizzle-conversation-v2-comparison-sink.ts src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts src/app/api/cron/message-worker/route.ts src/__tests__/ConversationV2EngineSelection.test.ts src/__tests__/ConversationV2ActivationApproval.test.ts src/__tests__/ConversationV2ShadowBatch.test.ts src/__tests__/DrizzleConversationV2Policy.test.ts src/__tests__/MessageWorkerV2Composition.test.ts
git commit -m "feat(conversation-v2): wire post-delivery tenant shadow mode"
```

Rollback operacional imediato: atualizar `organizations.conversation_engine` para `v1`; a migration é aditiva e V1 permanece intacta.

---

### Task 6: Runner do corpus, resultados reproduzíveis, folha humana e avaliação dos gates

> **Superseding pre-result amendment (2026-08-17):** before any real Cycle I V1×V2 result existed
> (zero observations, unsigned `NO_GO`; thresholds unchanged), the exact population was clarified
> as 17 cases/204 protocol positions with 15 comparable cases, 90 observed positions per arm and
> 180 total. The 24 positions for exactly `scheduling-0003` and `burst-0002` remain explicit
> `not_measurable` with `structured_pending_state_absent` until structured pending-slot state
> exists. Productive admission additionally requires actual clean Git HEAD/tree attestation, and
> all gate/human/replay evidence must come from registered, content-bound authority parsers rather
> than HMAC-shaped caller inputs.

> **Superseding source-attestation amendment (2026-08-17, pre-result):** review demonstrated that
> Git config/index/stat state cannot prove the bytes being executed. While the committed state
> still had zero real observations, unsigned artifacts and `NO_GO` (with every threshold and
> denominator unchanged), productive admission was strengthened to require a manifest-bound
> `implementationSourceDigest`. Node recomputes it from a closed module-root scope covering
> `src/**`, the Cycle-I CLI, package/lock and TypeScript config; path, mode, size and file bytes are
> canonical, while symlinks/escapes/duplicates/hardlinks/non-regular or concurrently changing files
> fail closed. Git commit/tree are retained only as additional traceability. The source digest must
> match before any productive arm call; generated metadata is excluded to avoid self-reference.

> **Trusted-bootstrap clarification (2026-08-17, pre-result):** this source digest is an admission
> snapshot inside a trusted execution substrate, not anti-host or supply-chain attestation. The
> trusted substrate is OS/filesystem, Node, `tsx`, package-manager installation from the committed
> lockfile, minimal bootstrap and no concurrent host mutation. The signed manifest also binds Node
> version/platform/architecture. The canonical bootstrap snapshots before dynamically importing
> dotenv/CLI/runner/providers; direct productive entry without its registered preflight fails
> closed. An external immutable/signed build or CI boundary is a future prerequisite if host or
> installed-dependency compromise enters scope. This clarification occurred at zero observations,
> unsigned `NO_GO`, and changes no threshold, denominator or gate.

> **Amendment after independent Task 6 review:** productive evidence is accepted only from the
> canonical parsed runner snapshot bound to a configured-authority-signed run manifest; serialized
> runs additionally require a measurement-run signature. The manifest binds commit/tree,
> corpus/population/D0/comparability, tenant fixtures, models, prompt/adapter sources and optional
> Decision/prose/full-turn artifacts. Decision uses a predeclared 17-case applicability manifest
> with effect-bound receipts. `scheduling-0003` and `burst-0002` lack structured pending-slot state
> and remain explicit `not_measurable`, outside the accuracy denominator but inside the 204-row
> protocol denominator. Approved prose + two calibrated reviewers and approved replay + isolated
> Lab are real parser paths; absent evidence remains blocking and is never synthesized.

**Files:**
- Create: `scripts/eval-conversation-v2-cycle-i-bootstrap.ts`
- Create: `scripts/eval-conversation-v2-cycle-i.ts`
- Create: `src/application/conversation-v2/corpus-comparison-runner.ts`
- Create: `src/application/conversation-v2/decision-fixture-manifest.ts`
- Create: `src/__tests__/ConversationV2CorpusRunner.test.ts`
- Create: `src/__tests__/ConversationV2GateEvidence.test.ts`
- Create: `evals/cycle-i/run-manifest.json`
- Create when the run succeeds: `evals/cycle-i/results/cycle-i-supported-n6.json`
- Create only after a complete valid run: `evals/cycle-i/human-review-sheet.json`
- Create if human ratings are supplied: `evals/cycle-i/human-review-r1.json`, `evals/cycle-i/human-review-r2.json`
- Create: `evals/cycle-i/gate-report.json`
- Modify: `package.json`

**Interfaces:**

```ts
export type CycleIUnderstandingArm = {
  runCase(input: { caseId: string; leadMessage: string; history: readonly Readonly<{ author: "lead" | "agent" | "operator"; body: string }>[]; fixedNow: string }): Promise<Readonly<{ request: string | null; model: ModelCallSummary | null }>>;
};

export type CycleIDecisionFixture = Readonly<{
  caseId: string;
  snapshotDigest: HmacRef;
  reads: CapturedV2TurnReads;
  executionReceipt: Readonly<{
    caseId: string;
    snapshotDigest: HmacRef;
    effect: Readonly<{ action: "book_slot" | "confirm_appointment"; payloadHash: string }>;
    outcomeType: DentalOutcomeType;
    sourceEvidenceDigest: HmacRef;
    receiptDigest: HmacRef;
  }> | null;
}>;

export function loadAuthorizedCycleIDecisionFixtureManifest(input: {
  path: string;
  authority: AuthorizedCycleIRunManifest;
  expectedCaseIds: readonly string[];
}): AuthorizedCycleIDecisionFixtureManifest;

export async function runCycleICorpusComparison(input: {
  corpusRoot: string;
  manifestPath: string;
  d0Path: string;
  decisionFixtureManifestPath: string | null;
  v1Understanding: CycleIUnderstandingArm;
  v2Understanding: CycleIUnderstandingArm;
  runs: 6;
  fixedClockByCase: Readonly<Record<string, string>>;
}): Promise<CycleIComparisonRun>;
```

O runner mede Understanding com a mensagem/histórico idênticos do corpus. Decision/ActionResult e
prosa são uma camada separada: só rodam para casos predeclarados no manifest de fixtures cujo
conteúdo, snapshot, applicability e receipt passam o parser autorizado. Ausência do manifest ou de receipt exigido produz
`supported_decision: not_measurable`; não cria `ApprovedEvalRecord` sintético.

CLI fechado:

```text
npm run eval:conversation-v2:cycle-i -- --mode measure --out evals/cycle-i/results/cycle-i-supported-n6.json
npm run eval:conversation-v2:cycle-i -- --mode build-human-sheet --run evals/cycle-i/results/cycle-i-supported-n6.json --out evals/cycle-i/human-review-sheet.json
npm run eval:conversation-v2:cycle-i -- --mode evaluate-gates --run evals/cycle-i/results/cycle-i-supported-n6.json --out evals/cycle-i/gate-report.json
```

`package.json`: `"eval:conversation-v2:cycle-i": "tsx scripts/eval-conversation-v2-cycle-i-bootstrap.ts"`. O bootstrap captura a attestation antes de carregar dotenv/CLI/runner/providers; o runner não importa DB/repositories e lê apenas corpus/fixtures commitados.

- [ ] **Step 1: escrever RED do runner**

Com arms de Understanding fake, provar 17 casos×6×2 = 204 observations, ordem intercalada, mesma mensagem/histórico/fixed clock, stable primary e D0 sensitivity separados, infrastructure error preservado, zero drop, denominadores iguais e output determinístico sem timestamp wall-clock. Separadamente, testar manifest de Decision ausente, sem autoridade, parcial, com snapshot digest divergente e write sem receipt content-bound; todos ficam `not_measurable` sem fabricar output.

- [ ] **Step 2: escrever RED dos gates de evidência**

Provar que deterministic/H/shadow/critical podem passar; `pending_human_review` bloqueia qualitative; ausência de replay aprovado torna `full_turn_cost` e `full_turn_p95` `not_measurable`; nenhum desses estados produz activation approval.

- [ ] **Step 3: confirmar RED**

Run: `npx vitest run src/__tests__/ConversationV2CorpusRunner.test.ts src/__tests__/ConversationV2GateEvidence.test.ts`

Expected: FAIL por runner/CLI ausentes.

- [ ] **Step 4: implementar runner sem espelhar o orquestrador**

V1 Understanding arm chama o `IntentClassifier` real e usa `v1Understanding` somente para traduzir
o intent produzido; o adapter existente não é tratado como executor de V1. V2 Understanding arm
usa `DentalUnderstandingProvider` sobre o mesmo input. Decision/ActionResult usa o pipeline real
somente quando `loadAuthorizedCycleIDecisionFixtureManifest` entrega reads/receipt aprovados; V1 Decision
fica `not_measurable` salvo quando a seam observacional emite outcome concreto. Não criar
`mapToAction`/decider paralelo nem `ApprovedEvalRecord` sintético. Medir chamadas/model/tokens/
latência dos boundaries reais disponíveis e marcar component metrics como diagnósticas.

- [ ] **Step 5: confirmar GREEN e integridade do corpus**

Run: `npx vitest run src/__tests__/ConversationV2CorpusRunner.test.ts src/__tests__/ConversationV2GateEvidence.test.ts src/__tests__/CycleFAcceptanceManifest.test.ts src/__tests__/DentalDecisionCorpusCoverage.test.ts src/__tests__/DentalUnderstandingContract.test.ts`

Expected: PASS.

- [ ] **Step 6: executar a medição `N = 6` quando a key estiver presente**

Verificar apenas presença, sem imprimir segredo: `node -e 'console.log(Boolean(process.env.OPENAI_API_KEY))'` dentro do comando dotenv. Se ausente, gerar gate report com `infrastructure_error/not_measurable`, sem inventar observações. Se presente, executar `--mode measure`; qualquer arm ausente invalida o par e a run.

- [ ] **Step 7: produzir a folha humana cega**

Executar `--mode build-human-sheet` somente se existir run V1×V2 completo e válido. Sem run, registrar `qualitative: not_measurable`; com run, não preencher ratings automaticamente. Se dois reviewers humanos calibrados entregarem arquivos completos, validar ambos e reexecutar gates; sem eles, manter `qualitative: pending_human_review`. Não usar o judge `experimental_non_gating` para GO.

- [ ] **Step 8: avaliar gates sem promover `not_measurable`**

Executar `--mode evaluate-gates`. Sem dataset `replay-dataset.v2` sanitizado, humano-aprovado, assinatura Ed25519 e Lab isolado, registrar `full_turn_cost` e `full_turn_p95` como `not_measurable`; não executar replay em produção nem chamar shadow component latency de full-turn.

- [ ] **Step 9: auditar PII e confirmar artefatos**

Run: `npm run corpus:audit-pii`

Run: `npx vitest run src/__tests__/ConversationV2ComparisonRecord.test.ts src/__tests__/ConversationV2ComparisonProtocol.test.ts src/__tests__/ConversationV2CorpusRunner.test.ts src/__tests__/ConversationV2GateEvidence.test.ts`

Expected: PASS; todos os artefatos têm commit/config/dataset/model digests, denominadores e status terminal inequívoco.

- [ ] **Step 10: commit**

```bash
git add package.json scripts/eval-conversation-v2-cycle-i.ts src/application/conversation-v2/corpus-comparison-runner.ts src/application/conversation-v2/decision-fixture-manifest.ts src/__tests__/ConversationV2CorpusRunner.test.ts src/__tests__/ConversationV2GateEvidence.test.ts evals/cycle-i
git commit -m "feat(conversation-v2): measure the frozen Cycle I comparison"
```

Não commitar arquivo de ratings que não tenha sido realmente preenchido por reviewer identificado e validado pelo parser.

---

### Task 7: Matriz final, revisão adversarial e verificação completa

**Files:**
- Create: `docs/ai-system/cycle-i-shadow-comparison.md`
- Modify: `docs/architecture/current.md`
- Create: `src/__tests__/ConversationV2JourneyMatrix.test.ts`
- Create: `src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts`
- Create: `src/__tests__/arch/ConversationV2NoLiveExecution.test.ts`

**Interfaces:**
- Consumes: `evals/cycle-i/gate-report.json`, comparison run, human sheet/ratings quando existentes, `ShadowBatchSummary` e todos os contracts das Tasks 1–6.
- Produces: relatório canônico do Ciclo I com estado terminal exatamente `GO INTERNAL V2`, `NO-GO INTERNAL V2` ou `BLOCKED`; nesta implementação, `GO INTERNAL V2` só é possível se todos os blocking gates forem `pass`, embora o path real continue desligado até revisão específica do shell.

- [ ] **Step 1: escrever RED da matriz e das fronteiras finais**

Matriz cobre price, availability, booking intent, write failure, escalation e multi-intent em happy/boundary/failure/adversarial/recovery. Unsupported permanece explicitamente `unsupported/deferred`. Testes arquiteturais provam: core sem V1/provider/DB/calendar/config/comparison; Dental Pack sem OpenAI/provider; runner offline sem DB; route thin; `v2_internal` sem path para writer/outbox/channel; shadow sem `Capability.execute` para writes.

- [ ] **Step 2: confirmar RED**

Run: `npx vitest run src/__tests__/ConversationV2JourneyMatrix.test.ts src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts src/__tests__/arch/ConversationV2NoLiveExecution.test.ts`

Expected: FAIL até a matriz importar e exercer os contratos produtivos das tasks anteriores.

- [ ] **Step 3: implementar a matriz mínima e fechar regressões encontradas por TDD**

Para qualquer bug: reproduzir no teste, confirmar RED, corrigir somente o owner da regra, confirmar GREEN e registrar o case/commit no relatório. Não adicionar capability para transformar `unsupported` em verde.

- [ ] **Step 4: escrever o relatório a partir dos artefatos, sem alegações não medidas**

`docs/ai-system/cycle-i-shadow-comparison.md` deve conter: checkpoint/SHAs; arquitetura final; 17 casos e D0 intersection; N/ordem/digests; métricas V1/V2 por camada; intended effects e prova de zero side effects; privacidade; qualitativo/judge/human status; custo/latência full-turn; matriz; findings/rejeições; regressões; rollback; gaps; gate por gate; conclusão terminal. `docs/architecture/current.md` registra somente o selector default V1, shadow pós-sender e `v2_internal` fail-closed — não afirma ativação.

- [ ] **Step 5: revisão adversarial independente**

Solicitar reviewer distinto para tentar falsificar: mesmas leituras/clock, ausência de outcome V1 na entrada V2, zero writers, ordering pós-sender, fail-closed em missing capture, H entailment, HMAC/PII, denominadores/N/thresholds, judge non-gating, full-turn gate, selector tenant isolation, rollback e inexistência de live V2. Todo Critical/Important confirmado segue reprodução → RED → correção mínima → GREEN → re-review.

- [ ] **Step 6: rodar suíte focada**

Run: `npx vitest run src/__tests__/TurnPipelinePreparation.test.ts src/__tests__/CapturedV2TurnReads.test.ts src/__tests__/DentalShadowAdapters.test.ts src/__tests__/V2ShadowRunner.test.ts src/__tests__/ConversationV2ComparisonRecord.test.ts src/__tests__/ConversationV2ComparisonProtocol.test.ts src/__tests__/ConversationV2HumanReview.test.ts src/__tests__/ConversationV2GateReport.test.ts src/__tests__/V1TurnObservation.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/ConversationV2EngineSelection.test.ts src/__tests__/ConversationV2ActivationApproval.test.ts src/__tests__/ConversationV2ShadowBatch.test.ts src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/ConversationV2CorpusRunner.test.ts src/__tests__/ConversationV2GateEvidence.test.ts src/__tests__/ConversationV2JourneyMatrix.test.ts src/__tests__/arch/V2ShadowWriteBoundary.test.ts src/__tests__/arch/V1ObservationSeamBoundary.test.ts src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts src/__tests__/arch/ConversationV2NoLiveExecution.test.ts src/__tests__/arch/CoreImportBoundary.test.ts src/__tests__/arch/CoreDomainLexicon.test.ts src/__tests__/arch/DentalPackBoundary.test.ts`

Expected: PASS.

- [ ] **Step 7: rodar regressões de agenda**

Run: `npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts`

Expected: PASS.

- [ ] **Step 8: executar verificação canônica**

Run: `npm run verify`

Expected: `db:check`, lint, typecheck e toda a suíte verdes. Não usar dotenv.

- [ ] **Step 9: auditar diffs e rollback**

Run: `git diff 99a852aa -- src/core`

Expected: somente split genérico de pipeline e seam observacional V1; nenhuma regra V1/dental nova no core.

Run: `git diff --check && git status --short`

Expected: zero whitespace error; somente arquivos intencionais. Confirmar em teste que mudar selector para `v1` desliga shadow sem revert.

- [ ] **Step 10: commit documental final**

```bash
git add docs/ai-system/cycle-i-shadow-comparison.md docs/architecture/current.md src/__tests__/ConversationV2JourneyMatrix.test.ts src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts src/__tests__/arch/ConversationV2NoLiveExecution.test.ts
git commit -m "docs(conversation-v2): close Cycle I with measured gates"
```

---

## Gate final e decisão

O executor deve derivar a conclusão do `gate-report.json`, nunca da impressão geral:

- `GO INTERNAL V2`: somente se todos os critérios bloqueantes são `pass`, revisão adversarial sem Critical/Important e o usuário autoriza a etapa de shell live separada. Este plano não liga esse path.
- `NO-GO INTERNAL V2`: implementação e instrumentos funcionam, mas um gate medido falhou, ficou `not_measurable` ou `pending_human_review`. Selector fica/volta `v1`; shadow pode permanecer somente onde explicitamente configurado.
- `BLOCKED`: não foi possível obter evidência técnica mínima por falha de infraestrutura que impediu até validar os instrumentos. Reportar branch, SHA, comando, resumo, âmbito local/CI/Vercel/produção e rollback mais seguro.

Mesmo com todos os testes verdes, ausência de revisão humana/instrumento calibrado ou de replay/Lab full-turn aprovado produz `NO-GO INTERNAL V2`, não uma exceção metodológica. Ciclo J e qualquer tenant externo permanecem fora de escopo.
