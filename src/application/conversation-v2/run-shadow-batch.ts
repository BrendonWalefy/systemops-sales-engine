import { isProxy } from "node:util/types";
import type { ConversationEnginePolicyReader } from "@/application/ports/conversation-engine-policy-reader";
import type { ConversationV2ComparisonSink } from "@/application/ports/conversation-v2-comparison-sink";
import type { InternalV2ActivationApproval } from "@/application/conversation-v2/activation-approval";
import {
  keyedRef,
  parseLiveComparisonRecord,
  type EngineStructuralSummary,
  type HmacRef,
  type LiveComparisonRecord,
  type ModelCallSummary,
} from "@/application/conversation-v2/comparison-record";
import { resolveConversationEngine } from "@/application/conversation-v2/engine-selection";
import {
  buildCapturedV2TurnReads,
  isRegisteredCapturedV1Turn,
  type CapturedV1Turn,
  type CapturedV2TurnReadsPromotion,
} from "@/application/conversation-v2/v1-observation-collector";
import type { V2ShadowResult } from "@/application/conversation-v2/v2-shadow-runner";
import type { CapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import type { DentalRequest } from "@/domain-packs/dental";

export type SenderDrainAttempted = Readonly<{
  outcome: "completed" | "failed_handled";
  occurredAt: string;
}>;

export type ShadowBatchTurn = Readonly<{
  clinicId: string;
  turn: CapturedV1Turn;
  promotion: CapturedV2TurnReadsPromotion;
}>;

export type ShadowEvaluation = Readonly<{
  result: V2ShadowResult;
  understandingRequest: DentalRequest | null;
  model: ModelCallSummary | null;
}>;

export type ShadowBatchSummary = Readonly<{
  received: number;
  selected: number;
  attempted: number;
  persisted: number;
  unsupported: number;
  skipped: number;
  policyErrors: number;
  evaluationErrors: number;
  sinkErrors: number;
  maxTurnsReached: boolean;
  deadlineReached: boolean;
}>;

const barriers = new WeakSet<object>();
const batchTurns = new WeakSet<object>();

function readDataRecord(
  input: unknown,
  expectedKeys: readonly string[],
  error: string,
): Record<string, unknown> {
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) throw new Error(error);
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key))
  ) throw new Error(error);
  const result: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(error);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function nonEmpty(value: unknown, error: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(error);
  return value;
}

function recordSenderDrainAttempt(input: {
  outcome: "completed" | "failed_handled";
  occurredAt: string;
}): SenderDrainAttempted {
  const source = readDataRecord(input, ["outcome", "occurredAt"], "invalid sender drain attempt");
  if (source.outcome !== "completed" && source.outcome !== "failed_handled") {
    throw new Error("invalid sender drain attempt outcome");
  }
  const occurredAt = nonEmpty(source.occurredAt, "invalid sender drain attempt timestamp");
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error("invalid sender drain attempt timestamp");
  const barrier = Object.freeze({ outcome: source.outcome, occurredAt });
  barriers.add(barrier);
  return barrier;
}

export async function runAfterSenderDrainAttempt<SenderResult, ShadowResult>(input: {
  drainSender(): Promise<SenderResult>;
  onSenderFailure(error: unknown): void | Promise<void>;
  occurredAt(): string;
  afterAttempt(barrier: SenderDrainAttempted): Promise<ShadowResult>;
}): Promise<Readonly<{
  senderOutcome: "completed" | "failed_handled";
  senderResult: SenderResult | null;
  shadowResult: ShadowResult;
}>> {
  let senderOutcome: SenderDrainAttempted["outcome"] = "completed";
  let senderResult: SenderResult | null = null;
  try {
    senderResult = await input.drainSender();
  } catch (error) {
    senderOutcome = "failed_handled";
    await input.onSenderFailure(error);
  }
  const barrier = recordSenderDrainAttempt({
    outcome: senderOutcome,
    occurredAt: input.occurredAt(),
  });
  const shadowResult = await input.afterAttempt(barrier);
  return Object.freeze({ senderOutcome, senderResult, shadowResult });
}

export function createShadowTurnCaptureRegistry(): Readonly<{
  bindTurn(input: Readonly<{ turnId: string; clinicId: string }>): void;
  promote(turn: CapturedV1Turn): ShadowBatchTurn;
}> {
  const tenantByTurn = new Map<string, string>();
  return Object.freeze({
    bindTurn(input) {
      const source = readDataRecord(input, ["turnId", "clinicId"], "invalid shadow turn binding");
      const turnId = nonEmpty(source.turnId, "invalid shadow turn binding");
      const clinicId = nonEmpty(source.clinicId, "invalid shadow turn binding");
      const existing = tenantByTurn.get(turnId);
      if (existing && existing !== clinicId) throw new Error("shadow turn clinic binding mismatch");
      tenantByTurn.set(turnId, clinicId);
    },
    promote(turn) {
      if (!isRegisteredCapturedV1Turn(turn)) {
        throw new Error("captured V1 turn is not registered");
      }
      const clinicId = tenantByTurn.get(turn.turnId);
      if (!clinicId) throw new Error("shadow turn has no tenant binding");
      tenantByTurn.delete(turn.turnId);
      const promotion = buildCapturedV2TurnReads({
        turnId: turn.turnId,
        sharedReads: turn.sharedReads,
      });
      const envelope = Object.freeze({ clinicId, turn, promotion });
      batchTurns.add(envelope);
      return envelope;
    },
  });
}

const emptyEngineSummary = Object.freeze({
  understandingRequest: null,
  capabilityIds: Object.freeze([]),
  decisionKinds: Object.freeze([]),
  outcomeTypes: Object.freeze([]),
  semanticClasses: Object.freeze([]),
  finalTextCharacters: null,
  finalTextDigest: null,
  fallbackSource: null,
  model: null,
});

function v1Summary(
  turn: CapturedV1Turn,
  hmacKey: string,
): EngineStructuralSummary {
  const plan = turn.controlArm.responsePlans.at(-1);
  const model = plan?.modelId
    ? {
        modelId: plan.modelId,
        calls: 1,
        inputTokens: plan.inputTokens,
        outputTokens: plan.outputTokens,
        latencyMs: plan.latencyMs,
        estimatedCostMinor: null,
      }
    : null;
  return {
    ...emptyEngineSummary,
    status: "observed",
    finalTextCharacters: plan?.responseCharacters ?? null,
    finalTextDigest: plan ? keyedRef(plan.responseDigest, hmacKey) : null,
    errorCode: null,
    model,
  };
}

function v2Summary(
  evaluation: ShadowEvaluation,
  hmacKey: string,
): EngineStructuralSummary {
  const base = {
    ...emptyEngineSummary,
    understandingRequest: evaluation.understandingRequest,
    model: evaluation.model,
  };
  const result = evaluation.result;
  if (result.status === "error") {
    return { ...base, status: "error", errorCode: "provider_error" };
  }
  if (result.status === "unsupported") {
    return { ...base, status: "unsupported", errorCode: result.reason };
  }
  if (result.status === "simulation_not_executed") {
    return {
      ...base,
      status: "simulation_not_executed",
      capabilityIds: result.decisions.map(({ capabilityId }) => capabilityId),
      decisionKinds: result.decisions.map(({ decision }) => decision.kind),
      errorCode: null,
    };
  }
  return {
    ...base,
    status: "observed",
    capabilityIds: result.actionResults.map(({ origin }) => origin.capabilityId),
    outcomeTypes: result.actionResults.map(({ type }) => type),
    semanticClasses: result.actionResults.map(({ semanticClass }) => semanticClass),
    finalTextCharacters: result.response.text.length,
    finalTextDigest: keyedRef(result.response.text, hmacKey),
    errorCode: null,
  };
}

function unavailableEvaluation(): ShadowEvaluation {
  return Object.freeze({
    result: Object.freeze({
      status: "unsupported" as const,
      reason: "shared_read_unavailable" as const,
    }),
    understandingRequest: null,
    model: null,
  });
}

function errorEvaluation(): ShadowEvaluation {
  return Object.freeze({
    result: Object.freeze({ status: "error" as const, errorName: "ShadowEvaluationError" }),
    understandingRequest: null,
    model: null,
  });
}

function buildRecord(input: {
  turn: ShadowBatchTurn;
  evaluation: ShadowEvaluation;
  hmacKey: string;
  commit: string;
  datasetDigest: HmacRef | null;
  allowedModelIds: ReadonlySet<string>;
}): LiveComparisonRecord {
  const intendedEffects = input.evaluation.result.status === "simulation_not_executed"
    ? input.evaluation.result.intendedEffects
    : [];
  return parseLiveComparisonRecord({
    version: "conversation-v2-live-comparison.v1",
    turnRef: keyedRef(input.turn.turn.turnId, input.hmacKey),
    conversationRef: null,
    inputRef: keyedRef(input.turn.turn.sharedReads.input.leadMessage, input.hmacKey),
    occurredAt: input.turn.turn.sharedReads.input.now,
    commit: input.commit,
    configDigest: keyedRef(
      input.turn.turn.sharedReads.tenantSnapshot.configFingerprint,
      input.hmacKey,
    ),
    datasetDigest: input.datasetDigest,
    v1: v1Summary(input.turn.turn, input.hmacKey),
    v2: v2Summary(input.evaluation, input.hmacKey),
    intendedEffects,
    divergenceCodes: [],
  }, input.allowedModelIds);
}

async function withDeadline<T>(promise: Promise<T>, remainingMs: number): Promise<T> {
  if (remainingMs <= 0) throw new Error("shadow deadline reached");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("shadow deadline reached")), remainingMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function snapshotBatchTurns(input: readonly ShadowBatchTurn[]): readonly ShadowBatchTurn[] {
  if (
    typeof input !== "object"
    || input === null
    || isProxy(input)
    || !Array.isArray(input)
    || Object.getPrototypeOf(input) !== Array.prototype
  ) throw new Error("invalid shadow batch turn array");
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) {
    throw new Error("invalid shadow batch turn array");
  }
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(input);
  if (
    !Number.isSafeInteger(length)
    || length < 0
    || keys.length !== length + 1
    || !keys.includes("length")
  ) throw new Error("invalid shadow batch turn array");
  const turns: ShadowBatchTurn[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid shadow batch turn array");
    }
    if (!batchTurns.has(descriptor.value)) {
      throw new Error("shadow batch turn is not registered");
    }
    turns.push(descriptor.value as ShadowBatchTurn);
  }
  return Object.freeze(turns);
}

export async function runConversationV2ShadowBatch(input: {
  senderBarrier: SenderDrainAttempted;
  turns: readonly ShadowBatchTurn[];
  policyReader: ConversationEnginePolicyReader;
  evaluator: Readonly<{
    evaluate(reads: CapturedV2TurnReads): Promise<ShadowEvaluation>;
  }>;
  sink: ConversationV2ComparisonSink;
  approval: InternalV2ActivationApproval | null;
  maxTurns: number;
  deadlineMs: number;
  now(): number;
  recordConfig: Readonly<{
    hmacKey: string;
    commit: string;
    datasetDigest: HmacRef | null;
    allowedModelIds: ReadonlySet<string>;
  }>;
}): Promise<ShadowBatchSummary> {
  if (!barriers.has(input.senderBarrier)) throw new Error("sender barrier is not registered");
  if (input.recordConfig.hmacKey.length < 32) throw new Error("comparison HMAC key must have at least 32 characters");
  if (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 0) throw new Error("invalid maxTurns");
  if (!Number.isFinite(input.deadlineMs) || input.deadlineMs < 0) throw new Error("invalid deadlineMs");
  const turns = snapshotBatchTurns(input.turns);
  const recordConfig = Object.freeze({
    hmacKey: input.recordConfig.hmacKey,
    commit: input.recordConfig.commit,
    datasetDigest: input.recordConfig.datasetDigest,
    allowedModelIds: new Set(input.recordConfig.allowedModelIds),
  });

  const startedAt = input.now();
  const deadlineAt = startedAt + input.deadlineMs;
  const summary = {
    received: turns.length,
    selected: 0,
    attempted: 0,
    persisted: 0,
    unsupported: 0,
    skipped: 0,
    policyErrors: 0,
    evaluationErrors: 0,
    sinkErrors: 0,
    maxTurnsReached: false,
    deadlineReached: false,
  };

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    if (index >= input.maxTurns) {
      summary.skipped += turns.length - index;
      summary.maxTurnsReached = true;
      break;
    }
    if (input.now() >= deadlineAt) {
      summary.skipped += turns.length - index;
      summary.deadlineReached = true;
      break;
    }

    let selected = false;
    try {
      const policy = await withDeadline(
        input.policyReader.getConversationEnginePolicy(turn.clinicId),
        deadlineAt - input.now(),
      );
      if (policy.clinicId !== turn.clinicId) throw new Error("conversation engine policy tenant mismatch");
      const effective = resolveConversationEngine({
        automationMode: "live",
        policy,
        approval: input.approval,
      });
      selected = effective.shadow;
    } catch {
      summary.policyErrors += 1;
    }
    if (!selected) {
      summary.skipped += 1;
      continue;
    }
    summary.selected += 1;

    let evaluation: ShadowEvaluation;
    if (turn.promotion.status === "shared_read_unavailable") {
      evaluation = unavailableEvaluation();
      summary.unsupported += 1;
    } else {
      summary.attempted += 1;
      try {
        evaluation = await withDeadline(
          input.evaluator.evaluate(turn.promotion.reads),
          deadlineAt - input.now(),
        );
        if (evaluation.result.status === "unsupported") summary.unsupported += 1;
      } catch {
        evaluation = errorEvaluation();
        summary.evaluationErrors += 1;
      }
    }

    try {
      const record = buildRecord({
        turn,
        evaluation,
        ...recordConfig,
      });
      await withDeadline(
        input.sink.append({ clinicId: turn.clinicId, record }),
        deadlineAt - input.now(),
      );
      summary.persisted += 1;
    } catch {
      summary.sinkErrors += 1;
    }
  }

  return Object.freeze(summary);
}
