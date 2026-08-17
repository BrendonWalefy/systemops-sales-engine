import { isProxy } from "node:util/types";
import type { ConversationEnginePolicyReader } from "@/application/ports/conversation-engine-policy-reader";
import type { ConversationEngineSelectionTraceSink } from "@/application/ports/conversation-engine-selection-trace";
import type { ConversationV2ComparisonSink } from "@/application/ports/conversation-v2-comparison-sink";
import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import type { InternalV2ActivationApproval } from "@/application/conversation-v2/activation-approval";
import {
  canonicalizeComparisonRecordConfig,
} from "@/application/conversation-v2/comparison-record-config";
import {
  keyedRef,
  parseLiveComparisonRecord,
  type EngineStructuralSummary,
  type HmacRef,
  type LiveComparisonRecord,
  type ModelCallSummary,
} from "@/application/conversation-v2/comparison-record";
import {
  resolveConversationEngine,
  type ConversationEngine,
  type EffectiveConversationEngine,
} from "@/application/conversation-v2/engine-selection";
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
  automationMode: ClinicAutomationMode;
  turn: CapturedV1Turn;
  promotion: CapturedV2TurnReadsPromotion;
}>;

export type ShadowEvaluation = Readonly<{
  result: V2ShadowResult;
  understandingRequest: DentalRequest | null;
  model: ModelCallSummary | null;
}>;

export type ShadowEvaluator = Readonly<{
  evaluate(reads: CapturedV2TurnReads, signal: AbortSignal): Promise<ShadowEvaluation>;
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
const barrierBatches = new WeakMap<object, readonly ShadowBatchTurn[]>();
const batchTurns = new WeakSet<object>();
const consumedBatchTurns = new WeakSet<object>();

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
  turns: readonly ShadowBatchTurn[];
  drainSender(): Promise<SenderResult>;
  onSenderFailure(error: unknown): void | Promise<void>;
  occurredAt(): string;
  afterAttempt(
    barrier: SenderDrainAttempted,
    turns: readonly ShadowBatchTurn[],
  ): Promise<ShadowResult>;
}): Promise<Readonly<{
  senderOutcome: "completed" | "failed_handled";
  senderResult: SenderResult | null;
  shadowResult: ShadowResult;
}>> {
  const turns = snapshotBatchTurns(input.turns);
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
  barrierBatches.set(barrier, turns);
  const shadowResult = await input.afterAttempt(barrier, turns);
  return Object.freeze({ senderOutcome, senderResult, shadowResult });
}

export function createShadowTurnCaptureRegistry(): Readonly<{
  bindTurn(input: Readonly<{
    turnId: string;
    clinicId: string;
    automationMode: ClinicAutomationMode;
  }>): void;
  promote(turn: CapturedV1Turn): ShadowBatchTurn;
}> {
  const bindingByTurn = new Map<string, Readonly<{
    clinicId: string;
    automationMode: ClinicAutomationMode;
  }>>();
  return Object.freeze({
    bindTurn(input) {
      const source = readDataRecord(
        input,
        ["turnId", "clinicId", "automationMode"],
        "invalid shadow turn binding",
      );
      const turnId = nonEmpty(source.turnId, "invalid shadow turn binding");
      const clinicId = nonEmpty(source.clinicId, "invalid shadow turn binding");
      const automationMode = source.automationMode;
      if (automationMode !== "live" && automationMode !== "observe" && automationMode !== "disabled") {
        throw new Error("invalid shadow turn automation binding");
      }
      const existing = bindingByTurn.get(turnId);
      if (
        existing
        && (existing.clinicId !== clinicId || existing.automationMode !== automationMode)
      ) throw new Error("shadow turn binding mismatch");
      bindingByTurn.set(turnId, Object.freeze({ clinicId, automationMode }));
    },
    promote(turn) {
      if (!isRegisteredCapturedV1Turn(turn)) {
        throw new Error("captured V1 turn is not registered");
      }
      const binding = bindingByTurn.get(turn.turnId);
      if (!binding) throw new Error("shadow turn has no tenant binding");
      bindingByTurn.delete(turn.turnId);
      const promotion = buildCapturedV2TurnReads({
        turnId: turn.turnId,
        sharedReads: turn.sharedReads,
      });
      const envelope = Object.freeze({ ...binding, turn, promotion });
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

function v1Summary(): EngineStructuralSummary {
  return {
    ...emptyEngineSummary,
    status: "observed",
    errorCode: null,
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
    v1: v1Summary(),
    v2: v2Summary(input.evaluation, input.hmacKey),
    intendedEffects,
    divergenceCodes: [],
  }, input.allowedModelIds);
}

class ShadowDeadlineError extends Error {}

function requireRemainingBudget(remainingMs: number): void {
  if (remainingMs <= 0) throw new ShadowDeadlineError("shadow deadline reached before dependency start");
}

async function settleStartedDependency<T>(
  start: () => Promise<T>,
  remainingMs: number,
): Promise<T> {
  requireRemainingBudget(remainingMs);
  return start();
}

async function settleAbortableDependency<T>(
  start: (signal: AbortSignal) => Promise<T>,
  remainingMs: number,
): Promise<T> {
  requireRemainingBudget(remainingMs);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new ShadowDeadlineError("shadow dependency deadline reached")),
    remainingMs,
  );
  try {
    const result = await start(controller.signal);
    if (controller.signal.aborted) throw new ShadowDeadlineError("shadow dependency deadline reached");
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new ShadowDeadlineError("shadow dependency deadline reached");
    throw error;
  } finally {
    clearTimeout(timeout);
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

function consumeBatchTurns(turns: readonly ShadowBatchTurn[]): void {
  const unique = new Set<object>();
  for (const turn of turns) {
    if (unique.has(turn)) throw new Error("duplicate shadow batch turn");
    if (!batchTurns.has(turn)) throw new Error("shadow batch turn is not registered");
    if (consumedBatchTurns.has(turn)) throw new Error("shadow batch turn is already consumed");
    unique.add(turn);
  }
  for (const turn of unique) consumedBatchTurns.add(turn);
}

export async function runConversationV2ShadowBatch(input: {
  senderBarrier: SenderDrainAttempted;
  turns: readonly ShadowBatchTurn[];
  policyReader: ConversationEnginePolicyReader;
  selectionTrace: ConversationEngineSelectionTraceSink;
  evaluator: ShadowEvaluator;
  sink: ConversationV2ComparisonSink;
  approval: InternalV2ActivationApproval | null;
  maxTurns: number;
  deadlineMs: number;
  now(): number;
  recordConfig: Readonly<{
    hmacKey: string;
    commit: string;
    datasetDigest: HmacRef | null;
    allowedModelIds: readonly string[];
  }>;
}): Promise<ShadowBatchSummary> {
  const turns = barrierBatches.get(input.senderBarrier);
  const barrierRegistered = barriers.has(input.senderBarrier);
  barriers.delete(input.senderBarrier);
  barrierBatches.delete(input.senderBarrier);
  if (
    !turns
    || turns !== input.turns
    || !barrierRegistered
  ) throw new Error("sender barrier is not registered for this batch snapshot");
  consumeBatchTurns(turns);
  const canonicalRecordConfig = canonicalizeComparisonRecordConfig(input.recordConfig);
  if (!Number.isSafeInteger(input.maxTurns) || input.maxTurns < 0) throw new Error("invalid maxTurns");
  if (!Number.isFinite(input.deadlineMs) || input.deadlineMs < 0) throw new Error("invalid deadlineMs");
  const recordConfig = Object.freeze({
    hmacKey: canonicalRecordConfig.hmacKey,
    commit: canonicalRecordConfig.commit,
    datasetDigest: canonicalRecordConfig.datasetDigest,
    allowedModelIds: new Set(canonicalRecordConfig.allowedModelIds),
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

  const recordSelection = async (
    turn: ShadowBatchTurn,
    selection: Readonly<{
      configuredEngine: ConversationEngine | null;
      effectiveRoute: "v1";
      shadow: boolean;
      reason: EffectiveConversationEngine["reason"] | "policy_unavailable";
    }>,
  ): Promise<void> => {
    try {
      await input.selectionTrace.record(Object.freeze({
        turnRef: keyedRef(turn.turn.turnId, recordConfig.hmacKey),
        clinicId: turn.clinicId,
        occurredAt: turn.turn.sharedReads.input.now,
        automationMode: turn.automationMode,
        ...selection,
      }));
    } catch {
      // Selection observability is best-effort and cannot affect V1 or shadow.
    }
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

    if (turn.automationMode !== "live") {
      await recordSelection(turn, {
        configuredEngine: null,
        effectiveRoute: "v1",
        shadow: false,
        reason: "automation_not_live",
      });
      summary.skipped += 1;
      continue;
    }

    let selected = false;
    try {
      const policy = await settleStartedDependency(
        () => input.policyReader.getConversationEnginePolicy(turn.clinicId),
        deadlineAt - input.now(),
      );
      if (policy.clinicId !== turn.clinicId) throw new Error("conversation engine policy tenant mismatch");
      const effective = resolveConversationEngine({
        automationMode: turn.automationMode,
        policy,
        approval: input.approval,
      });
      await recordSelection(turn, {
        configuredEngine: policy.engine,
        effectiveRoute: effective.route,
        shadow: effective.shadow,
        reason: effective.reason,
      });
      selected = effective.shadow;
    } catch (error) {
      if (error instanceof ShadowDeadlineError) {
        summary.deadlineReached = true;
        summary.skipped += turns.length - index;
        break;
      }
      summary.policyErrors += 1;
      await recordSelection(turn, {
        configuredEngine: null,
        effectiveRoute: "v1",
        shadow: false,
        reason: "policy_unavailable",
      });
    }
    if (input.now() >= deadlineAt) {
      summary.deadlineReached = true;
      summary.skipped += turns.length - index;
      break;
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
        const reads = turn.promotion.reads;
        evaluation = await settleAbortableDependency(
          (signal) => input.evaluator.evaluate(reads, signal),
          deadlineAt - input.now(),
        );
        if (evaluation.result.status === "unsupported") summary.unsupported += 1;
      } catch (error) {
        evaluation = errorEvaluation();
        summary.evaluationErrors += 1;
        if (error instanceof ShadowDeadlineError) {
          summary.deadlineReached = true;
          summary.skipped += turns.length - index - 1;
          break;
        }
      }
    }

    try {
      const record = buildRecord({
        turn,
        evaluation,
        ...recordConfig,
      });
      await settleStartedDependency(
        () => input.sink.append({ clinicId: turn.clinicId, record }),
        deadlineAt - input.now(),
      );
      summary.persisted += 1;
    } catch (error) {
      if (error instanceof ShadowDeadlineError) {
        summary.deadlineReached = true;
        summary.skipped += turns.length - index - 1;
        break;
      }
      summary.sinkErrors += 1;
    }
    if (input.now() >= deadlineAt) {
      summary.deadlineReached = true;
      summary.skipped += turns.length - index - 1;
      break;
    }
  }

  return Object.freeze(summary);
}
