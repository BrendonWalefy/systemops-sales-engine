# Conversation Reliability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer toda resposta composta passar por um plano autorizado, validação determinística e fallback seguro, registrar a decisão no replay e iniciar a decomposição mensurável do `ConversationOrchestrator` sem reescrita total.

**Architecture:** Um `ResponsePlanBuilder` transforma o resultado determinístico da ação e as fontes canônicas já resolvidas em uma allowlist de fatos. `ConversationResponsePlanner` chama o composer somente para verbalizar, valida texto e mídia antes da persistência e usa fallback determinístico quando a saída viola o plano ou o provider falha. O replay recebe expectativas golden estruturadas, enquanto helpers de montagem de resposta saem do orquestrador por uma seam compatível.

**Tech Stack:** TypeScript 5.8, Next.js 16, Vitest, PostgreSQL/Drizzle existente, Decision Trace e replay sandbox existentes.

## Global Constraints

- O LLM entende e verbaliza; o sistema decide.
- Nenhuma regra específica de clínica entra em prompt ou constante universal.
- Preços e condições vêm somente de `commercialPolicy`/catálogo já resolvidos; slots vêm somente da agenda do turno.
- Ximendes permanece somente leitura; nenhum comando deste plano acessa ou altera seu tenant.
- Nenhum envio real de WhatsApp, transferência de Z-API, deploy ou ativação de automação faz parte deste plano.
- Replay real exige dataset sanitizado, revisão humana, assinatura Ed25519 e banco isolado.
- Decision Trace guarda apenas códigos, contagens, enums e digests; nunca texto, prompt, resposta, telefone, nome, preço bruto ou URL.
- Não há mudança de schema neste plano. Se a implementação descobrir necessidade de coluna/tabela, parar e abrir plano de migration separado.
- Imports públicos atualmente feitos de `ConversationOrchestrator.ts` continuam funcionando por re-export durante a extração.
- Antes de cada push, PR, merge ou deploy executar `npm run verify`.

---

### Task 1: Contrato e builder do plano autorizado

**Files:**
- Create: `src/core/conversation/response-plan.ts`
- Create: `src/core/conversation/response-plan-builder.ts`
- Test: `src/__tests__/ResponsePlanBuilder.test.ts`

**Interfaces:**
- Consumes: `ActionResult`, `ResponsePart` e IDs de mídia já filtrados pelo tenant.
- Produces:

```ts
export const RESPONSE_PLAN_VERSION = "response-plan.v1" as const;

export type ResponsePlanViolationCode =
  | "empty_response"
  | "response_too_long"
  | "too_many_questions"
  | "unauthorized_media"
  | "unauthorized_price"
  | "unauthorized_schedule_fact"
  | "unsupported_guarantee";

export type AuthorizedResponsePlan = {
  version: typeof RESPONSE_PLAN_VERSION;
  action: ActionResult["type"];
  allowedPriceCents: readonly number[];
  allowedScheduleFacts: readonly string[];
  allowedMediaIds: readonly string[];
  maxQuestions: number;
  maxCharacters: number;
  expectedState: string;
};

export type BuildResponsePlanInput = {
  actionResult: ActionResult;
  commercialPolicy: string | null;
  installmentTable: string | null;
  allowedMediaIds: readonly string[];
  expectedState: string | null;
  maxCharacters: number;
};

export function buildAuthorizedResponsePlan(
  input: BuildResponsePlanInput,
): AuthorizedResponsePlan;
```

- `allowedPriceCents` contém valores monetários explícitos extraídos de `commercialPolicy`, `installmentTable` e campos monetários estruturados do `ActionResult`; não inclui números sem marcador monetário.
- `allowedScheduleFacts` contém somente labels vindos dos slots/agendamentos do `ActionResult`.
- Arrays saem normalizados, deduplicados e ordenados para gerar digest estável.

- [ ] **Step 1: Escrever testes que falham para fatos monetários, slots, mídia e limites**

```ts
const slotA = {
  index: 1,
  startsAt: "2026-08-10T17:00:00.000Z",
  endsAt: "2026-08-10T18:00:00.000Z",
  label: "Seg 10/08 às 14h",
};

it("autoriza apenas preços das fontes canônicas", () => {
  const plan = buildAuthorizedResponsePlan({
    actionResult: { type: "price_inquiry", referencedPriceCents: 180_000 },
    commercialPolicy: "Pacote cadastrado: R$ 2.400,00 à vista.",
    installmentTable: "10x de R$ 270,00",
    allowedMediaIds: [],
    expectedState: "idle",
    maxCharacters: 420,
  });

  expect(plan.allowedPriceCents).toEqual([27_000, 180_000, 240_000]);
});

it("autoriza somente labels de agenda retornadas pela ação", () => {
  const plan = buildAuthorizedResponsePlan({
    actionResult: {
      type: "slots_found",
      askedForPreference: false,
      slots: [slotA],
    },
    commercialPolicy: null,
    installmentTable: null,
    allowedMediaIds: ["video-b", "video-a", "video-a"],
    expectedState: "awaiting_confirmation",
    maxCharacters: 500,
  });

  expect(plan.allowedScheduleFacts).toEqual(["Seg 10/08 às 14h"]);
  expect(plan.allowedMediaIds).toEqual(["video-a", "video-b"]);
  expect(plan.expectedState).toBe("awaiting_confirmation");
});
```

- [ ] **Step 2: Rodar o teste e confirmar RED**

Run: `npm test -- src/__tests__/ResponsePlanBuilder.test.ts`

Expected: FAIL porque os módulos ainda não existem.

- [ ] **Step 3: Implementar tipos, parser monetário BRL e coleta de fatos estruturados**

```ts
export function extractExplicitBrlCents(source: string | null): number[] {
  if (!source) return [];
  const values = [...source.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/gi)]
    .map((match) => Number(match[1]!.replace(/\./g, "")) * 100 + Number(match[2] ?? "0"));
  return [...new Set(values)].sort((a, b) => a - b);
}
```

Implementar coleta explícita para `slots_found`, `appointment_confirmed`, `appointment_rescheduled`, `appointments_listed`, `slots_expired`, `slot_taken_reoffered`, `evaluation_redirect`, reminders e `referencedPriceCents`. Ações sem agenda não recebem fatos de agenda.

- [ ] **Step 4: Rodar testes do builder**

Run: `npm test -- src/__tests__/ResponsePlanBuilder.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/conversation/response-plan.ts src/core/conversation/response-plan-builder.ts src/__tests__/ResponsePlanBuilder.test.ts
git commit -m "feat(conversation): define authorized response plans"
```

### Task 2: Validador determinístico de texto e mídia

**Files:**
- Create: `src/core/conversation/response-validator.ts`
- Test: `src/__tests__/ResponseValidator.test.ts`

**Interfaces:**
- Consumes: `AuthorizedResponsePlan` e `Pick<ComposedResponse, "text" | "parts">`.
- Produces:

```ts
export type ResponseValidationResult =
  | { ok: true; violations: readonly [] }
  | { ok: false; violations: readonly ResponsePlanViolationCode[] };

export function validateComposedResponse(input: {
  plan: AuthorizedResponsePlan;
  response: Pick<ComposedResponse, "text" | "parts">;
}): ResponseValidationResult;
```

- A validação nunca corrige texto silenciosamente. Ela aceita ou recusa a resposta inteira.
- Claims monetários são detectados apenas quando possuem `R$`, `reais` ou valor de parcela explícito.
- Horários são autorizados pela normalização dos labels; uma resposta não pode introduzir outra data/hora.
- Garantias proibidas: resultado garantido, 100% garantido, sem risco, resultado certo e promessa equivalente normalizada.

- [ ] **Step 1: Escrever matriz RED de violações e resposta válida**

```ts
const basePlan: AuthorizedResponsePlan = {
  version: "response-plan.v1",
  action: "general_question",
  allowedPriceCents: [],
  allowedScheduleFacts: [],
  allowedMediaIds: [],
  maxQuestions: 1,
  maxCharacters: 420,
  expectedState: "idle",
};

const makePlan = (
  overrides: Partial<AuthorizedResponsePlan> = {},
): AuthorizedResponsePlan => ({ ...basePlan, ...overrides });

it.each([
  ["", "empty_response"],
  ["O valor é R$ 9.999,00.", "unauthorized_price"],
  ["Tenho terça às 19h.", "unauthorized_schedule_fact"],
  ["O resultado é 100% garantido.", "unsupported_guarantee"],
])("recusa %s com %s", (text, code) => {
  const result = validateComposedResponse({
    plan: makePlan(),
    response: { text, parts: text ? [{ type: "text", content: text }] : [] },
  });
  expect(result).toEqual(expect.objectContaining({ ok: false }));
  expect(result.violations).toContain(code);
});

it("aceita preço, slot e mídia presentes no plano", () => {
  const result = validateComposedResponse({
    plan: makePlan({
      allowedPriceCents: [240_000],
      allowedScheduleFacts: ["Seg 10/08 às 14h"],
      allowedMediaIds: ["case-1"],
    }),
    response: {
      text: "O valor é R$ 2.400,00. Tenho Seg 10/08 às 14h. Qual prefere?",
      parts: [
        { type: "text", content: "O valor é R$ 2.400,00. Tenho Seg 10/08 às 14h. Qual prefere?" },
        { type: "media", id: "case-1" },
      ],
    },
  });
  expect(result).toEqual({ ok: true, violations: [] });
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npm test -- src/__tests__/ResponseValidator.test.ts`

Expected: FAIL porque o validator ainda não existe.

- [ ] **Step 3: Implementar detectores puros e retorno com códigos ordenados**

```ts
const VIOLATION_ORDER: ResponsePlanViolationCode[] = [
  "empty_response",
  "response_too_long",
  "too_many_questions",
  "unauthorized_media",
  "unauthorized_price",
  "unauthorized_schedule_fact",
  "unsupported_guarantee",
];
```

Não registrar nem retornar o texto problemático. Deduplicar violações e ordenar por `VIOLATION_ORDER`.

- [ ] **Step 4: Rodar validator e guards existentes de composer**

Run: `npm test -- src/__tests__/ResponseValidator.test.ts src/__tests__/ResponseComposerScheduleLeakGuard.test.ts src/__tests__/QuantityPriceGuard.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/conversation/response-validator.ts src/__tests__/ResponseValidator.test.ts
git commit -m "feat(conversation): validate composed replies against plan"
```

### Task 3: Fallback seguro por resultado de ação

**Files:**
- Create: `src/core/conversation/safe-response-fallback.ts`
- Test: `src/__tests__/SafeResponseFallback.test.ts`

**Interfaces:**
- Consumes: `ActionResult` e `AuthorizedResponsePlan`.
- Produces:

```ts
export type SafeResponseFallback = {
  response: ComposedResponse;
  requiresHandoff: boolean;
  reason: "composer_error" | "response_plan_violation";
};

export function buildSafeResponseFallback(input: {
  actionResult: ActionResult;
  plan: AuthorizedResponsePlan;
  reason: SafeResponseFallback["reason"];
}): SafeResponseFallback;
```

- Slot/appointment usa somente labels presentes no plano.
- Quantidade não cadastrada e avaliação clínica mantêm a cópia determinística já aprovada.
- Perguntas editoriais/preço sem resposta determinística usam uma frase curta de precisão e `requiresHandoff: true`.
- O fallback não inclui mídia, não usa voz e não cria novo preço/slot.

- [ ] **Step 1: Escrever testes RED para slots exatos e handoff neutro**

```ts
const slotA = {
  index: 1,
  startsAt: "2026-08-10T17:00:00.000Z",
  endsAt: "2026-08-10T18:00:00.000Z",
  label: "Seg 10/08 às 14h",
};
const slotB = {
  index: 2,
  startsAt: "2026-08-11T18:00:00.000Z",
  endsAt: "2026-08-11T19:00:00.000Z",
  label: "Ter 11/08 às 15h",
};
const makePlan = (
  overrides: Partial<AuthorizedResponsePlan> = {},
): AuthorizedResponsePlan => ({
  version: "response-plan.v1",
  action: "slots_found",
  allowedPriceCents: [],
  allowedScheduleFacts: [],
  allowedMediaIds: [],
  maxQuestions: 1,
  maxCharacters: 500,
  expectedState: "slots_offered",
  ...overrides,
});

it("lista somente os slots autorizados", () => {
  const fallback = buildSafeResponseFallback({
    actionResult: { type: "slots_found", askedForPreference: false, slots: [slotA, slotB] },
    plan: makePlan({ allowedScheduleFacts: [slotA.label, slotB.label] }),
    reason: "composer_error",
  });
  expect(fallback.response.text).toContain(slotA.label);
  expect(fallback.response.text).toContain(slotB.label);
  expect(fallback.requiresHandoff).toBe(false);
});

it("não inventa resposta editorial quando a composição é insegura", () => {
  const fallback = buildSafeResponseFallback({
    actionResult: { type: "general_question", clinicContext: "contexto interno" },
    plan: makePlan(),
    reason: "response_plan_violation",
  });
  expect(fallback.response.text).toBe(
    "Quero te responder isso com precisão. Vou chamar nossa equipe para confirmar e continuar por aqui.",
  );
  expect(fallback.requiresHandoff).toBe(true);
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npm test -- src/__tests__/SafeResponseFallback.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar respostas determinísticas sem acesso a banco ou LLM**

Todo retorno usa `model: "deterministic-fallback"`, `promptVersion: "response-fallback.v1"` e tokens zero.

- [ ] **Step 4: Rodar fallback e experiência atual**

Run: `npm test -- src/__tests__/SafeResponseFallback.test.ts src/__tests__/ResponseComposerExperience.test.ts src/__tests__/ConversationExperience.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/conversation/safe-response-fallback.ts src/__tests__/SafeResponseFallback.test.ts
git commit -m "feat(conversation): add deterministic response fallback"
```

### Task 4: Serviço único de planejar, compor e validar

**Files:**
- Create: `src/core/conversation/ConversationResponsePlanner.ts`
- Test: `src/__tests__/ConversationResponsePlanner.test.ts`

**Interfaces:**
- Consumes: um adapter compatível com `ResponseComposer.compose`, `BuildResponsePlanInput` e `ComposerInput`.
- Produces:

```ts
export type ResponseComposerPort = {
  compose(input: ComposerInput): Promise<ComposedResponse>;
};

export type PlannedResponse = {
  plan: AuthorizedResponsePlan;
  response: ComposedResponse;
  source: "composer" | "deterministic_fallback";
  violations: readonly ResponsePlanViolationCode[];
  requiresHandoff: boolean;
  fallbackReason: SafeResponseFallback["reason"] | null;
};

export class ConversationResponsePlanner {
  constructor(private readonly composer: ResponseComposerPort = new ResponseComposer()) {}
  async execute(input: {
    composerInput: ComposerInput;
    planInput: Omit<BuildResponsePlanInput, "actionResult">;
  }): Promise<PlannedResponse>;
}
```

- [ ] **Step 1: Escrever testes RED de caminho válido, violação e erro do provider**

```ts
const validComposerInput: ComposerInput = {
  actionResult: { type: "general_question", clinicContext: "Dúvida autorizada" },
  conversationHistory: [],
  clinic: {
    name: "Clínica Teste",
    specialty: "odontologia",
    toneOfVoice: null,
    playbook: null,
    commercialPolicy: null,
  },
  timezone: new ClinicTimezone("America/Sao_Paulo"),
  isFirstMessage: false,
};

const composed = (text: string): ComposedResponse => ({
  text,
  parts: text ? [{ type: "text", content: text }] : [],
  mediaIds: [],
  model: "fake-composer",
  promptVersion: "test",
  inputTokens: 1,
  outputTokens: 1,
});

const input = () => ({
  composerInput: validComposerInput,
  planInput: {
    commercialPolicy: null,
    installmentTable: null,
    allowedMediaIds: [],
    expectedState: "idle",
    maxCharacters: 420,
  },
});

it("mantém a resposta quando passa no plano", async () => {
  const composer = { compose: vi.fn().mockResolvedValue(composed("Resposta válida")) };
  const result = await new ConversationResponsePlanner(composer).execute(input());
  expect(result.source).toBe("composer");
  expect(result.violations).toEqual([]);
});

it("substitui resposta que inventa preço sem vazar o texto em diagnostics", async () => {
  const composer = { compose: vi.fn().mockResolvedValue(composed("Custa R$ 9.999,00")) };
  const result = await new ConversationResponsePlanner(composer).execute(input());
  expect(result.source).toBe("deterministic_fallback");
  expect(result.violations).toEqual(["unauthorized_price"]);
  expect(JSON.stringify(result)).not.toContain("9.999");
});

it("usa fallback quando o composer lança", async () => {
  const composer = { compose: vi.fn().mockRejectedValue(new Error("timeout")) };
  const result = await new ConversationResponsePlanner(composer).execute(input());
  expect(result.fallbackReason).toBe("composer_error");
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npm test -- src/__tests__/ConversationResponsePlanner.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar fluxo build → compose → validate → fallback**

O `catch` nunca retorna `Error.message`; somente `fallbackReason`. O texto inválido nunca entra no objeto final.

- [ ] **Step 4: Rodar testes da camada de resposta**

Run: `npm test -- src/__tests__/ResponsePlanBuilder.test.ts src/__tests__/ResponseValidator.test.ts src/__tests__/SafeResponseFallback.test.ts src/__tests__/ConversationResponsePlanner.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/conversation/ConversationResponsePlanner.ts src/__tests__/ConversationResponsePlanner.test.ts
git commit -m "feat(conversation): centralize response planning"
```

### Task 5: Integrar planner e Decision Trace no orquestrador

**Files:**
- Modify: `src/core/observability/DecisionTrace.ts`
- Modify: `src/core/pipeline/ConversationOrchestrator.ts`
- Test: `src/__tests__/DecisionTrace.test.ts`
- Test: `src/__tests__/ConversationResponsePlanner.test.ts`
- Test: `src/__tests__/ReplayTraceContract.test.ts`

**Interfaces:**
- Adiciona stages sanitizados:

```ts
| "response.plan_built"
| "response.validated"
| "response.fallback_applied"
```

- `ConversationOrchestrator` aceita `responsePlanner?: ConversationResponsePlanner` no construtor.
- Cada chamada atual ao helper `compose(actionResult)` passa pelo planner com:
  - `commercialPolicy` e `installmentTable` já resolvidos;
  - IDs da biblioteca já filtrada;
  - `expectedState: currentConversationState?.state ?? "none"`;
  - limite de 280/600/1.200 caracteres para modos conciso/padrão/detalhado.
- Se `requiresHandoff` for verdadeiro, marca `needsAttention`, usa razão fixa `Resposta segura requer revisão humana` e notifica operadores sem colocar texto do lead/LLM no trace.

- [ ] **Step 1: Escrever testes RED para allowlist dos novos stages e metadados**

```ts
it("registra somente metadados sanitizados de validação", async () => {
  const sink = new InMemoryDecisionTraceSink();
  await recordDecisionTrace(sink, {
    turnId: "turn-1",
    stage: "response.validated",
    occurredAt: "2026-08-09T00:00:00.000Z",
    clinicId: "clinic-1",
    conversationId: "conversation-1",
    metadata: { action: "price_inquiry", valid: false, violationCount: 1 },
  });
  expect(sink.getEvents()[0]?.metadata).toEqual({
    action: "price_inquiry",
    valid: false,
    violationCount: 1,
  });
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npm test -- src/__tests__/DecisionTrace.test.ts src/__tests__/ReplayTraceContract.test.ts`

Expected: FAIL no novo stage.

- [ ] **Step 3: Injetar o planner e substituir o helper local do composer**

O helper local continua acumulando `composerInputTokens`, `composerOutputTokens`, `composerModel`, parts e media IDs a partir de `PlannedResponse.response`. Registrar:

```ts
await recordDecisionTrace(this.decisionTraceSink, {
  turnId,
  stage: "response.validated",
  occurredAt: runtimeNow().toISOString(),
  clinicId,
  conversationId: conversation.id,
  metadata: {
    action: actionResult.type,
    valid: planned.source === "composer",
    violationCount: planned.violations.length,
    requiresHandoff: planned.requiresHandoff,
  },
});
```

Não gravar lista de preços, slots, IDs de mídia, texto, erro do provider ou conteúdo da política.

- [ ] **Step 4: Rodar regressões conversacionais focadas**

Run: `npm test -- src/__tests__/ConversationWave2Guards.test.ts src/__tests__/ConversationRhythmGuards.test.ts src/__tests__/QuantityPriceGuard.test.ts src/__tests__/ResponseComposerScheduleLeakGuard.test.ts src/__tests__/OutboundDeliveryOrdering.test.ts src/__tests__/ReplayTraceContract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/observability/DecisionTrace.ts src/core/pipeline/ConversationOrchestrator.ts src/__tests__/DecisionTrace.test.ts src/__tests__/ConversationResponsePlanner.test.ts src/__tests__/ReplayTraceContract.test.ts
git commit -m "feat(conversation): enforce response plans before outbox"
```

### Task 6: Expectativas golden estruturadas no replay

**Files:**
- Modify: `src/application/replay/contracts.ts`
- Modify: `src/application/replay/replay-scenario-request.ts`
- Create: `src/application/replay/evaluate-golden-expectations.ts`
- Test: `src/__tests__/ReplayGoldenExpectations.test.ts`
- Test: `src/__tests__/ReplayScenarioRequest.test.ts`

**Interfaces:**
- Extensão opcional e retrocompatível de `ReplayScenarioV1`; o JSON assinado cobre o campo quando presente:

```ts
export type ReplayGoldenExpectationsV1 = {
  schemaVersion: "replay-golden-expectations.v1";
  requiredTraceStages: DecisionTraceStage[];
  forbiddenTraceStages: DecisionTraceStage[];
  finalConversation: {
    aiPaused: boolean | null;
    needsAttention: boolean | null;
  };
  finalState: string | null;
  outbound: {
    minEffects: number;
    maxEffects: number;
    requiredKinds: Array<"text" | "voice" | "media" | "suppressed">;
  };
  calendar: { maxWriteEffects: number };
};

export function evaluateReplayGoldenExpectations(input: {
  expectations: ReplayGoldenExpectationsV1;
  trace: DecisionTraceEventV1[];
  finalConversation: { aiPaused: boolean; needsAttention: boolean } | null;
  finalState: string | null;
  outboundEffects: ReplayOutboundEffect[];
  calendarEffects: ReplayCalendarEffect[];
}): Array<{ code: string; passed: boolean }>;
```

- Checks possuem códigos fixos; não incluem transcript nem detail livre.
- Cenários sem `expectations` continuam executáveis, mas não podem contar como golden path.

- [ ] **Step 1: Escrever testes RED para stage, estado, handoff, outbox e calendário**

```ts
const golden = (
  overrides: Partial<ReplayGoldenExpectationsV1> = {},
): ReplayGoldenExpectationsV1 => ({
  schemaVersion: "replay-golden-expectations.v1",
  requiredTraceStages: [],
  forbiddenTraceStages: [],
  finalConversation: { aiPaused: null, needsAttention: null },
  finalState: null,
  outbound: { minEffects: 0, maxEffects: 10, requiredKinds: [] },
  calendar: { maxWriteEffects: 0 },
  ...overrides,
});

const trace = (stage: DecisionTraceStage): DecisionTraceEventV1[] => [{
  schemaVersion: "decision-trace.v1",
  sequence: 0,
  turnId: "turn-1",
  stage,
  occurredAt: "2026-08-09T00:00:00.000Z",
}];

it("falha quando um golden path não passa pela validação de resposta", () => {
  const checks = evaluateReplayGoldenExpectations({
    expectations: golden({ requiredTraceStages: ["response.validated"] }),
    trace: trace("intent.resolved"),
    finalConversation: { aiPaused: false, needsAttention: false },
    finalState: "idle",
    outboundEffects: [{ kind: "text", sequence: 1 } as ReplayOutboundEffect],
    calendarEffects: [],
  });
  expect(checks).toContainEqual({
    code: "golden_required_trace_stages",
    passed: false,
  });
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npm test -- src/__tests__/ReplayGoldenExpectations.test.ts src/__tests__/ReplayScenarioRequest.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar validação estrutural e evaluator puro**

`assertReplayScenarioRequest` rejeita limites negativos, `minEffects > maxEffects`, stages desconhecidos e strings fora das enums.

- [ ] **Step 4: Rodar contratos de replay**

Run: `npm test -- src/__tests__/ReplayGoldenExpectations.test.ts src/__tests__/ReplayScenarioRequest.test.ts src/__tests__/ReplayDatasetApproval.test.ts src/__tests__/ReplayExportPolicy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/replay/contracts.ts src/application/replay/replay-scenario-request.ts src/application/replay/evaluate-golden-expectations.ts src/__tests__/ReplayGoldenExpectations.test.ts src/__tests__/ReplayScenarioRequest.test.ts
git commit -m "feat(replay): define structured golden expectations"
```

### Task 7: Aplicar golden gates no replay fiel e no relatório batch

**Files:**
- Modify: `src/app/api/e2e/replay/scenario/route.ts`
- Modify: `scripts/run-approved-replay-dataset.ts`
- Modify: `src/application/replay/replay-trace-contract.ts`
- Test: `src/__tests__/ReplayTraceContract.test.ts`
- Test: `src/__tests__/ReplayScenarioRouteGuard.test.ts`

**Interfaces:**
- A rota lê `aiPaused`, `needsAttention` e estado terminal antes do cleanup.
- Quando o cenário contém expectativas, concatena os checks `golden_*` aos checks de fidelidade existentes.
- Um cenário golden só retorna HTTP 200 quando todos os checks estruturais passam.
- O batch report inclui `goldenRunCount`, `goldenPassedCount` e `goldenFailedCount`; resultados sem expectativas ficam separados e não inflam a taxa golden.

- [ ] **Step 1: Escrever testes RED para completude do trace com response plan**

```ts
const completeBase = [
  { turnId: "turn-1", stage: "ingress.received" },
  { turnId: "turn-1", stage: "orchestrator.started" },
  { turnId: "turn-1", stage: "state.loaded" },
  { turnId: "turn-1", stage: "intent.classified" },
  { turnId: "turn-1", stage: "intent.resolved" },
  {
    turnId: "turn-1",
    stage: "outbound.planned",
    metadata: { responsePlanVersion: "response-plan.v1" },
  },
  {
    turnId: "turn-1",
    stage: "orchestrator.completed",
    metadata: { replied: true },
  },
] as const;

it("aceita turno composto somente quando o response plan foi validado", () => {
  expect(isReplayTurnTraceComplete([
    ...completeBase,
    { turnId: "turn-1", stage: "response.plan_built" },
    { turnId: "turn-1", stage: "response.validated" },
    { turnId: "turn-1", stage: "outbound.enqueued" },
    { turnId: "turn-1", stage: "delivery.sent" },
  ], "turn-1")).toBe(true);
});
```

Adicionar caso negativo sem `response.validated` quando `outbound.planned.metadata.responsePlanVersion === "response-plan.v1"`.

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npm test -- src/__tests__/ReplayTraceContract.test.ts src/__tests__/ReplayScenarioRouteGuard.test.ts`

Expected: FAIL.

- [ ] **Step 3: Integrar evaluator e contadores sem expor transcript em erro**

O output detalhado já existente permanece no arquivo privado do runner. O stdout continua somente com caminho, contagens e estado terminal.

- [ ] **Step 4: Rodar toda suíte de replay**

Run: `npm test -- src/__tests__/Replay*.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/e2e/replay/scenario/route.ts scripts/run-approved-replay-dataset.ts src/application/replay/replay-trace-contract.ts src/__tests__/ReplayTraceContract.test.ts src/__tests__/ReplayScenarioRouteGuard.test.ts
git commit -m "feat(replay): enforce golden conversation gates"
```

### Task 8: Extrair montagem de resposta do arquivo gigante

**Files:**
- Create: `src/core/conversation/conversation-response-parts.ts`
- Modify: `src/core/pipeline/ConversationOrchestrator.ts`
- Test: `src/__tests__/ConversationResponseParts.test.ts`
- Test: existing response/media suites listed below.

**Interfaces:**
- Mover, com helpers privados relacionados, estas funções para o novo módulo:
  - `filterMediaLibraryForTreatment`
  - `filterMediaLibraryForComposer`
  - `isValidMediaAssetId`
  - `mergeDeliveryMediaLibrary`
  - `resolveOutboundParts`
  - `buildAnswerFirstPipelineContent`
  - `stripPriceProseWhenSystemQuoted`
  - `hasAgentRequestedPhoto`
  - `pickShowcaseMedia`
- `ConversationOrchestrator.ts` importa internamente e re-exporta os mesmos símbolos para compatibilidade temporária.
- O módulo novo não acessa banco, env, relógio, LLM ou tenant implícito.
- Gate de tamanho deste marco: `ConversationOrchestrator.ts` termina com menos de 8.300 linhas e nenhum comportamento é alterado pela extração.

- [ ] **Step 1: Criar teste de caracterização importando do novo módulo**

```ts
const log = createLogger({ scope: "ConversationResponsePartsTest" });

it("preserva a ordem texto-mídia-texto", () => {
  const result = resolveOutboundParts(
    [
      { type: "text", content: "Antes" },
      { type: "media", id: "media-1", caption: "Legenda" },
      { type: "text", content: "Depois" },
    ],
    [{
      id: "media-1",
      title: "Caso autorizado",
      type: "video",
      url: "https://example.invalid/video",
      treatmentId: null,
    }],
    log,
    null,
  );
  expect(result.map((part) => part.type)).toEqual(["text", "media", "text"]);
});
```

- [ ] **Step 2: Rodar e confirmar RED**

Run: `npm test -- src/__tests__/ConversationResponseParts.test.ts`

Expected: FAIL porque o módulo ainda não existe.

- [ ] **Step 3: Mover mecanicamente funções e manter re-exports**

Não renomear parâmetros, não mudar regexes e não aproveitar esta task para “limpar” comportamento. Imports do novo módulo devem ser explícitos.

- [ ] **Step 4: Rodar caracterização, regressões de mídia e gate de tamanho**

Run: `npm test -- src/__tests__/ConversationResponseParts.test.ts src/__tests__/OutboundDeliveryOrdering.test.ts src/__tests__/MediaDeliveryReliability.test.ts src/__tests__/PipelineAnswerFirst.test.ts src/__tests__/PipelineMediaGapWarning.test.ts src/__tests__/QuantityPriceGuard.test.ts`

Run: `test "$(wc -l < src/core/pipeline/ConversationOrchestrator.ts)" -lt 8300`

Expected: todos PASS e exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/core/conversation/conversation-response-parts.ts src/core/pipeline/ConversationOrchestrator.ts src/__tests__/ConversationResponseParts.test.ts
git commit -m "refactor(conversation): extract response assembly seam"
```

### Task 9: Verificação, documentação e handoff seguro

**Files:**
- Modify: `docs/architecture/current.md`
- Modify: `docs/architecture/replay-and-decision-trace.md`
- Create: `.superpowers/sdd/2026-08-09-conversation-reliability-foundation/task-9-report.md`

**Interfaces:**
- Documentar o caminho `ActionResult → AuthorizedResponsePlan → composer → validator → fallback/outbox`.
- Registrar que a primeira extração não conclui a decomposição do orquestrador; próximos seams são `HandoffPolicy`, `AgendaOfferService`, `TreatmentJourneyService` e `ReservationAndDepositService`.
- Handoff lista exatamente quais validações estão bloqueantes, quais são fallback e quais golden datasets privados ainda precisam ser executados no Lab.

- [ ] **Step 1: Atualizar arquitetura e replay sem declarar validação real não executada**

O texto deve distinguir:

```text
Unit/integration green != approved private replay green != Lab validation green.
```

- [ ] **Step 2: Executar verificações focadas e diff safety**

Run: `npm test -- src/__tests__/ResponsePlanBuilder.test.ts src/__tests__/ResponseValidator.test.ts src/__tests__/SafeResponseFallback.test.ts src/__tests__/ConversationResponsePlanner.test.ts src/__tests__/ReplayGoldenExpectations.test.ts src/__tests__/ReplayTraceContract.test.ts`

Run: `git diff --check origin/develop...HEAD`

Expected: PASS e exit 0.

- [ ] **Step 3: Executar verificação completa obrigatória**

Run: `npm run verify`

Expected: Drizzle meta, lint, typecheck e todos os testes PASS; skips existentes são reportados, não ocultados.

- [ ] **Step 4: Registrar relatório com evidência exata e stop gates**

O relatório precisa incluir:

- branch e SHAs;
- comandos e exit codes;
- contagens de testes/skips;
- linhas do orquestrador antes/depois;
- nenhuma migration;
- nenhum acesso a cliente, Z-API ou provider real;
- replay privado ainda não executado, quando verdadeiro;
- rollback por commits independentes.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/current.md docs/architecture/replay-and-decision-trace.md .superpowers/sdd/2026-08-09-conversation-reliability-foundation/task-9-report.md
git commit -m "docs(conversation): hand off response safety foundation"
```

## Plan Self-Review

- Spec coverage: cobre master design §§8, 15, 20 (Fase 2), 21 e 22.
- Scope: não mistura migration, UI, realtime, template odontológico, follow-up, Meta ou operação de cliente.
- Type consistency: `AuthorizedResponsePlan`, `PlannedResponse`, `ReplayGoldenExpectationsV1` e stages do trace têm um único dono definido antes do consumo.
- Privacy: nenhuma interface de observabilidade transporta conteúdo ou fatos comerciais brutos.
- Rollout: toda resposta passa por validação antes da outbox; qualquer falha degrada para cópia determinística e/ou handoff.
- Orchestrator: a redução é progressiva, com re-export compatível e gate objetivo abaixo de 8.300 linhas.
