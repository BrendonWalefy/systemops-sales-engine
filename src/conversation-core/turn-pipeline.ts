import type { Capability, CapabilityContext, ConversationState, StructuredPolicy } from "@/conversation-core/capability/contract";
import { coordinateCapabilities } from "@/conversation-core/capability/coordinator";
import { buildV2AuthorizedResponsePlan, canonicalizeActionResults } from "@/conversation-core/authorized-response-plan";
import type { ComposerStyle, CoreResponse, ResponseComposerPort } from "@/conversation-core/composer/contract";
import { runV2ResponsePipeline } from "@/conversation-core/composer/response-pipeline";
import type {
  ResponseVerbalizerPort,
  SpeakerProfile,
  VerbalizationOutcome,
} from "@/conversation-core/composer/verbalization";
import type { ActionResult, Decision, OutcomeSchema, OutcomeTypeOf } from "@/conversation-core/decision";
import { evaluateTurnGate, type TurnGateInput } from "@/conversation-core/gate";
import type { Understanding } from "@/conversation-core/understanding/schema";

export type TurnPipelineResult<Schema extends OutcomeSchema = OutcomeSchema> =
  | { status: "suppressed"; reason: string }
  | { status: "needs_clarification" }
  | { status: "escalated"; reason: "capability_conflict"; capabilityIds: readonly string[] }
  | { status: "rejected"; actionResults: readonly ActionResult<Schema>[] }
  | { status: "delivered"; capabilityIds: readonly string[]; actionResults: readonly ActionResult<Schema>[]; response: CoreResponse };

export type ResponseStageInput<OutcomeType extends string> = Readonly<{
  style: ComposerStyle;
  composer: ResponseComposerPort<OutcomeType>;
  verbalization?: Readonly<{
    verbalizer: ResponseVerbalizerPort;
    speaker: SpeakerProfile;
    timeoutMs?: number;
  }>;
}>;

export type PreparedDecision = Readonly<{ capabilityId: string; decision: Decision }>;
export type TurnResponseAudit = Readonly<{
  plan: Readonly<{
    version: "authorized-response-plan.v2";
    outcomeRefs: readonly string[];
    evidenceRefs: readonly string[];
    outcomeCount: number;
    factCount: number;
    optionCount: number;
    subjectCount: number;
    evidenceCount: number;
    allowedFactKeys: readonly string[];
  }>;
  validation: Readonly<{
    valid: boolean;
    violations: readonly string[];
    source: "draft" | "repair" | "fallback" | "none";
    verbalization: VerbalizationOutcome;
    requiresHandoff: boolean;
    latencyMs: number;
  }>;
}>;
declare const preparedTurnTypes: unique symbol;
export type PreparedTurn<Request extends string, Policy extends object, ClaimPayload extends object, Schema extends OutcomeSchema> = Readonly<{
  capabilityIds: readonly string[];
  decisions: readonly PreparedDecision[];
}> & Readonly<{
  readonly [preparedTurnTypes]?: { request: Request; policy: Policy; claimPayload: ClaimPayload; schema: Schema };
}>;
export type PrepareTurnPipelineResult<Request extends string, Policy extends object, ClaimPayload extends object, Schema extends OutcomeSchema> =
  | { status: "suppressed"; reason: string }
  | { status: "needs_clarification" }
  | { status: "escalated"; reason: "capability_conflict"; capabilityIds: readonly string[] }
  | { status: "prepared"; prepared: PreparedTurn<Request, Policy, ClaimPayload, Schema> };

type PreparedExecution<Request extends string, Policy extends object, ClaimPayload extends object, Schema extends OutcomeSchema> = Readonly<{
  capability: Capability<Request, Policy, ClaimPayload, Schema>;
  decision: Decision;
  context: CapabilityContext<Policy>;
}>;

const preparedTurnRegistry = new WeakMap<object, readonly PreparedExecution<string, object, object, OutcomeSchema>[]>();

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasSubjectShape(value: unknown): boolean {
  return isPlainRecord(value) && hasExactKeys(value, ["type", "id", "displayName"])
    && isNonEmptyString(value.type) && isNonEmptyString(value.id) && isNonEmptyString(value.displayName);
}

function hasEvidenceShape(value: unknown): boolean {
  return isPlainRecord(value) && hasExactKeys(value, ["source", "reference"])
    && (value.source === "policy" || value.source === "read" || value.source === "write" || value.source === "derived")
    && isNonEmptyString(value.reference);
}

function hasFactValueShape(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  if (value.kind === "display_text") return hasExactKeys(value, ["kind", "value"]) && typeof value.value === "string";
  if (value.kind === "integer") return hasExactKeys(value, ["kind", "value"]) && typeof value.value === "number" && Number.isFinite(value.value);
  if (value.kind === "money") return hasExactKeys(value, ["kind", "amountInMinor", "currency"])
    && typeof value.amountInMinor === "number" && Number.isFinite(value.amountInMinor) && value.currency === "BRL";
  return value.kind === "boolean" && hasExactKeys(value, ["kind", "value"]) && typeof value.value === "boolean";
}

function hasFactShape(value: unknown): boolean {
  return isPlainRecord(value) && hasExactKeys(value, ["key", "value", "subject", "evidence", "disclosure"])
    && isNonEmptyString(value.key) && hasFactValueShape(value.value)
    && (value.subject === null || hasSubjectShape(value.subject)) && hasEvidenceShape(value.evidence)
    && (value.disclosure === "allowed" || value.disclosure === "internal");
}

function hasNextBestStepShape(value: unknown): boolean {
  return value === null || (isPlainRecord(value) && hasExactKeys(value, ["id", "repeatPolicy"])
    && isNonEmptyString(value.id)
    && (value.repeatPolicy === "once_until_answered" || value.repeatPolicy === "every_turn" || value.repeatPolicy === "never_repeat"));
}

function hasOptionShape(value: unknown): boolean {
  return isPlainRecord(value) && hasExactKeys(value, ["id", "facts"])
    && isNonEmptyString(value.id) && Array.isArray(value.facts) && value.facts.every(hasFactShape);
}

function hasPendingActionShape(value: unknown): boolean {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["type", "parameters"])
    || !isNonEmptyString(value.type) || !isPlainRecord(value.parameters)) return false;
  return Object.entries(value.parameters).every(([key, parameter]) => isNonEmptyString(key)
    && (typeof parameter === "string" || typeof parameter === "boolean"
      || (typeof parameter === "number" && Number.isFinite(parameter))));
}

function assertDecisionShape(value: unknown): asserts value is Decision {
  if (!isPlainRecord(value) || typeof value.kind !== "string") throw new Error("invalid decision shape");
  const valid = (value.kind === "close" && hasExactKeys(value, ["kind"]))
    || ((value.kind === "suppress" || value.kind === "escalate") && hasExactKeys(value, ["kind", "reason"]) && isNonEmptyString(value.reason))
    || (value.kind === "ask" && hasExactKeys(value, ["kind", "questionId"]) && isNonEmptyString(value.questionId))
    || (value.kind === "answer" && hasExactKeys(value, ["kind", "facts", "nextBestStep"])
      && Array.isArray(value.facts) && value.facts.every(hasFactShape) && hasNextBestStepShape(value.nextBestStep))
    || (value.kind === "offer" && hasExactKeys(value, ["kind", "subject", "options", "nextBestStep"])
      && hasSubjectShape(value.subject) && Array.isArray(value.options) && value.options.every(hasOptionShape) && hasNextBestStepShape(value.nextBestStep))
    || (value.kind === "execute" && hasExactKeys(value, ["kind", "action", "nextBestStep"])
      && hasPendingActionShape(value.action) && hasNextBestStepShape(value.nextBestStep));
  if (!valid) throw new Error("invalid decision shape");
}

function assertSourceHasOnlyDataProperties(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const isArray = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (isArray ? Array.prototype : Object.prototype)) throw new Error("invalid decision shape");
  for (const key of Reflect.ownKeys(value)) {
    if (isArray && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new Error("invalid decision shape");
    assertSourceHasOnlyDataProperties(descriptor.value);
  }
}

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  Object.freeze(value);
}

function canonicalizeDecision(value: Decision): Decision {
  // Descriptor inspection rejects accessors before any value read from the
  // decision. It traverses only data-descriptor values, never invoking getters.
  assertSourceHasOnlyDataProperties(value);
  let snapshot: unknown;
  try {
    // This is the single value read from the untrusted Decision and rejects Proxy values.
    snapshot = structuredClone(value);
  } catch {
    throw new Error("decision could not be canonicalized");
  }
  assertDecisionShape(snapshot);
  deepFreeze(snapshot);
  return snapshot;
}

export async function prepareTurnPipeline<Request extends string, Policy extends object, ClaimPayload extends object, Schema extends OutcomeSchema>(input: {
  gateInput: TurnGateInput;
  state: ConversationState;
  policy: StructuredPolicy<Policy>;
  now: Date;
  understand(): Promise<Understanding<Request>>;
  capabilities: readonly Capability<Request, Policy, ClaimPayload, Schema>[];
}): Promise<PrepareTurnPipelineResult<Request, Policy, ClaimPayload, Schema>> {
  const gate = evaluateTurnGate(input.gateInput);
  if (gate.outcome === "suppress") return { status: "suppressed", reason: gate.reason };
  const understanding = await input.understand();
  if (understanding.safety.optOut === true) {
    return { status: "suppressed", reason: "opted_out" };
  }
  const coordination = coordinateCapabilities({ capabilities: input.capabilities, understanding, state: input.state });
  if (coordination.outcome === "conflict") {
    return { status: "escalated", reason: "capability_conflict", capabilityIds: Object.freeze([...coordination.capabilityIds]) };
  }
  if (coordination.claimed.length === 0) return { status: "needs_clarification" };

  const context = { state: input.state, policy: input.policy, now: new Date(input.now.getTime()) } as CapabilityContext<Policy>;
  const executions: PreparedExecution<Request, Policy, ClaimPayload, Schema>[] = [];
  const decisions: PreparedDecision[] = [];
  for (const item of coordination.claimed) {
    const decision = canonicalizeDecision(await item.capability.decide(item.claim, context));
    executions.push(Object.freeze({ capability: item.capability, decision, context }));
    decisions.push(Object.freeze({ capabilityId: item.capability.id, decision }));
  }
  const prepared = Object.freeze({
    capabilityIds: Object.freeze(executions.map(({ capability }) => capability.id)),
    decisions: Object.freeze(decisions),
  }) as PreparedTurn<Request, Policy, ClaimPayload, Schema>;
  preparedTurnRegistry.set(
    prepared,
    Object.freeze(executions) as unknown as readonly PreparedExecution<string, object, object, OutcomeSchema>[],
  );
  return { status: "prepared", prepared };
}

export async function completeTurnPipeline<Request extends string, Policy extends object, ClaimPayload extends object, Schema extends OutcomeSchema>(input: {
  prepared: PreparedTurn<Request, Policy, ClaimPayload, Schema>;
  outcomeSchema: Schema;
  onActionResults?: (actionResults: readonly ActionResult<Schema>[]) => void | Promise<void>;
  onResponseAudit?: (audit: TurnResponseAudit) => void | Promise<void>;
  response: ResponseStageInput<OutcomeTypeOf<Schema>>;
}): Promise<TurnPipelineResult<Schema>> {
  const executions = preparedTurnRegistry.get(input.prepared);
  if (!executions) throw new Error("unregistered prepared turn");
  // A prepared turn is an effect authorization, not a replay token. Consume it
  // before the first execute so a second completion cannot duplicate effects.
  preparedTurnRegistry.delete(input.prepared);
  const untrustedActionResults: ActionResult<Schema>[] = [];
  for (const item of executions) {
    untrustedActionResults.push((await item.capability.execute(item.decision, item.context)) as ActionResult<Schema>);
  }
  const actionResults = canonicalizeActionResults(input.outcomeSchema, untrustedActionResults);
  if (actionResults.length !== executions.length) throw new Error("action result count mismatch");
  actionResults.forEach((result, index) => {
    const expectedOwner = executions[index]!.capability.id;
    if (result.origin.capabilityId !== expectedOwner) throw new Error(`action result owner mismatch: ${result.origin.capabilityId}`);
  });
  await input.onActionResults?.(actionResults);
  const plan = buildV2AuthorizedResponsePlan(input.outcomeSchema, actionResults);
  const responseStartedAt = performance.now();
  const responseResult = await runV2ResponsePipeline({
    plan,
    style: input.response.style,
    composer: input.response.composer,
    verbalization: input.response.verbalization,
  });
  await input.onResponseAudit?.(Object.freeze({
    plan: Object.freeze({
      version: plan.version,
      outcomeRefs: Object.freeze(plan.outcomes.map(({ ref }) => ref)),
      evidenceRefs: Object.freeze(plan.evidence.map(({ ref }) => ref)),
      outcomeCount: plan.outcomes.length,
      factCount: plan.facts.length,
      optionCount: plan.options.length,
      subjectCount: plan.subjects.length,
      evidenceCount: plan.evidence.length,
      allowedFactKeys: Object.freeze(plan.facts
        .filter(({ disclosure }) => disclosure === "allowed")
        .map(({ key }) => key)),
    }),
    validation: Object.freeze({
      valid: responseResult.status === "rendered",
      violations: Object.freeze(responseResult.status === "no_safe_response"
        ? [...new Set([
            ...responseResult.violations.map(({ code }) => code),
            responseResult.reason,
          ])]
        : []),
      source: responseResult.status === "rendered" ? responseResult.source : "none",
      verbalization: responseResult.status === "rendered"
        ? responseResult.verbalization
        : { status: "absent" as const },
      requiresHandoff: plan.outcomes.some(
        ({ semanticClass }) => semanticClass === "human_action_required",
      ),
      latencyMs: Math.max(0, Math.round(performance.now() - responseStartedAt)),
    }),
  }));
  if (responseResult.status === "no_safe_response") return { status: "rejected", actionResults };
  return { status: "delivered", capabilityIds: input.prepared.capabilityIds, actionResults, response: responseResult.response };
}

export async function runTurnPipeline<Request extends string, Policy extends object, ClaimPayload extends object, Schema extends OutcomeSchema>(input: {
  gateInput: TurnGateInput;
  state: ConversationState;
  policy: StructuredPolicy<Policy>;
  now: Date;
  understand(): Promise<Understanding<Request>>;
  capabilities: readonly Capability<Request, Policy, ClaimPayload, Schema>[];
  outcomeSchema: Schema;
  response: ResponseStageInput<OutcomeTypeOf<Schema>>;
}): Promise<TurnPipelineResult<Schema>> {
  const preparation = await prepareTurnPipeline({
    gateInput: input.gateInput, state: input.state, policy: input.policy, now: input.now,
    understand: input.understand, capabilities: input.capabilities,
  });
  if (preparation.status !== "prepared") return preparation;
  return completeTurnPipeline({ prepared: preparation.prepared, outcomeSchema: input.outcomeSchema, response: input.response });
}
