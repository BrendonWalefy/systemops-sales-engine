import { isProxy } from "node:util/types";
import type { ConversationEnginePolicyReader } from "@/application/ports/conversation-engine-policy-reader";
import type { ConversationV2ComparisonSink } from "@/application/ports/conversation-v2-comparison-sink";
import type { ClinicAutomationMode } from "@/application/automation/clinic-automation-policy";
import type { InternalV2ActivationApproval } from "@/application/conversation-v2/activation-approval";
import {
  isRegisteredCycleIRuntimeBuildIdentity,
  type CycleIRuntimeBuildIdentity,
} from "@/application/conversation-v2/configured-cycle-i-authority";
import {
  canonicalizeComparisonRecordConfig,
} from "@/application/conversation-v2/comparison-record-config";
import {
  LIVE_COMPARISON_VERSION,
  keyedRef,
  parseLiveComparisonRecord,
  type HmacRef,
  type LiveComparisonRecord,
  type ModelCallSummary,
  type V1EngineStructuralSummary,
  type V2EngineStructuralSummary,
} from "@/application/conversation-v2/comparison-record";
import {
  canonicalizeConversationEnginePolicy,
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

export type ShadowEngineSelection = Readonly<{
  turnRef: HmacRef;
  clinicRef: HmacRef;
  automationMode: ClinicAutomationMode;
  configuredEngine: ConversationEngine | null;
  effectiveRoute: "v1";
  shadow: boolean;
  reason: EffectiveConversationEngine["reason"] | "policy_unavailable";
}>;

export type ShadowAdmissionDeadlineSummary = Readonly<{
  startedAt: number;
  deadlineAt: number;
  admissionClosed: boolean;
  admissionClosedAt: number | null;
  returnedAt: number | null;
  overrun: boolean;
  overrunMs: number;
  clockStatus: "valid" | "malformed";
}>;

export type ShadowOperationDrainSummary = Readonly<{
  admitted: number;
  settled: number;
  completed: number;
  failed: number;
  abortRequested: number;
  cooperativelyAborted: number;
  activeAtReturn: number;
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
  deadline: ShadowAdmissionDeadlineSummary;
  drain: ShadowOperationDrainSummary;
  selections: readonly ShadowEngineSelection[];
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

function v1Summary(): V1EngineStructuralSummary {
  return {
    ...emptyEngineSummary,
    status: "unavailable",
    errorCode: "final_response_unavailable",
  };
}

function v2Summary(
  evaluation: ShadowEvaluation,
  hmacKey: string,
): V2EngineStructuralSummary {
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
    return { ...base, status: "unsupported", errorCode: result.reason, model: null };
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
    version: LIVE_COMPARISON_VERSION,
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
    comparisonStatus: "not_measurable",
    comparisonReason: "v1_final_response_unavailable",
    intendedEffects,
    divergenceCodes: [],
  }, input.allowedModelIds);
}

class ShadowDeadlineError extends Error {}
class ShadowClockError extends Error {}

const MAX_SHADOW_BATCH_TURNS = 1_000;
const MAX_SHADOW_BATCH_DEADLINE_MS = 60_000;

type ShadowOperationKind = "policy_read" | "provider_call" | "comparison_write";

type AdmissionState = {
  now: () => number;
  startedAt: number;
  deadlineAt: number;
  deadlineMs: number;
  monotonicStartedAt: number;
  lastClockSample: number;
  clockStatus: "valid" | "malformed";
  admissionClosed: boolean;
  admissionClosedAt: number | null;
  operations: {
    admitted: number;
    completed: number;
    failed: number;
    abortRequested: number;
    cooperativelyAborted: number;
    active: number;
  };
};

function monotonicElapsedMs(state: AdmissionState): number {
  return Math.max(0, performance.now() - state.monotonicStartedAt);
}

function closeAdmission(state: AdmissionState, occurredAt: number): void {
  state.admissionClosed = true;
  if (state.admissionClosedAt === null) state.admissionClosedAt = occurredAt;
}

function malformedClockClosureAt(state: AdmissionState): number {
  return state.lastClockSample >= state.deadlineAt
    || monotonicElapsedMs(state) >= state.deadlineMs
    ? state.deadlineAt
    : state.lastClockSample;
}

function sampleRuntimeClock(state: AdmissionState): number | null {
  let sample: number;
  try {
    sample = state.now();
  } catch {
    state.clockStatus = "malformed";
    closeAdmission(state, malformedClockClosureAt(state));
    return null;
  }
  if (!Number.isFinite(sample) || sample < state.lastClockSample) {
    state.clockStatus = "malformed";
    closeAdmission(state, malformedClockClosureAt(state));
    return null;
  }
  state.lastClockSample = sample;
  return sample;
}

function observeAdmission(state: AdmissionState): Readonly<{ remainingMs: number }> | null {
  if (state.admissionClosed) return null;
  const sample = sampleRuntimeClock(state);
  if (sample === null) return null;
  const wallRemainingMs = state.deadlineAt - sample;
  const monotonicRemainingMs = state.deadlineMs - monotonicElapsedMs(state);
  if (wallRemainingMs <= 0 || monotonicRemainingMs <= 0) {
    closeAdmission(state, state.deadlineAt);
    return null;
  }
  return Object.freeze({ remainingMs: Math.min(wallRemainingMs, monotonicRemainingMs) });
}

function requireAdmission(state: AdmissionState): Readonly<{ remainingMs: number }> {
  const admission = observeAdmission(state);
  if (!admission) {
    throw new ShadowDeadlineError("shadow admission deadline reached before dependency start");
  }
  return admission;
}

async function settleStartedDependency<T>(
  state: AdmissionState,
  _kind: Exclude<ShadowOperationKind, "provider_call">,
  start: () => Promise<T>,
): Promise<T> {
  requireAdmission(state);
  state.operations.admitted += 1;
  state.operations.active += 1;
  try {
    const result = await start();
    state.operations.completed += 1;
    return result;
  } catch (error) {
    state.operations.failed += 1;
    throw error;
  } finally {
    state.operations.active -= 1;
  }
}

async function settleAbortableDependency<T>(
  state: AdmissionState,
  _kind: Extract<ShadowOperationKind, "provider_call">,
  start: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const { remainingMs } = requireAdmission(state);
  state.operations.admitted += 1;
  state.operations.active += 1;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => {
      closeAdmission(state, state.deadlineAt);
      state.operations.abortRequested += 1;
      controller.abort(new ShadowDeadlineError("shadow dependency admission deadline reached"));
    },
    remainingMs,
  );
  try {
    const result = await start(controller.signal);
    if (controller.signal.aborted) throw new ShadowDeadlineError("shadow dependency deadline reached");
    state.operations.completed += 1;
    return result;
  } catch (error) {
    state.operations.failed += 1;
    if (controller.signal.aborted) {
      if (error === controller.signal.reason) {
        state.operations.cooperativelyAborted += 1;
      }
      throw new ShadowDeadlineError("shadow dependency deadline reached");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    state.operations.active -= 1;
  }
}

function finalizeAdmission(state: AdmissionState): Readonly<{
  deadline: ShadowAdmissionDeadlineSummary;
  drain: ShadowOperationDrainSummary;
}> {
  const returnedAt = sampleRuntimeClock(state);
  const elapsedMs = monotonicElapsedMs(state);
  if (
    (returnedAt !== null && returnedAt >= state.deadlineAt)
    || elapsedMs >= state.deadlineMs
  ) {
    closeAdmission(state, state.deadlineAt);
  }
  const wallOverrunMs = Math.max(0, state.lastClockSample - state.deadlineAt);
  const overrunMs = Math.max(
    wallOverrunMs,
    Math.max(0, elapsedMs - state.deadlineMs),
  );
  const deadline = Object.freeze({
    startedAt: state.startedAt,
    deadlineAt: state.deadlineAt,
    admissionClosed: state.admissionClosed,
    admissionClosedAt: state.admissionClosedAt,
    returnedAt,
    overrun: overrunMs > 0,
    overrunMs,
    clockStatus: state.clockStatus,
  });
  const drain = Object.freeze({
    admitted: state.operations.admitted,
    settled: state.operations.completed + state.operations.failed,
    completed: state.operations.completed,
    failed: state.operations.failed,
    abortRequested: state.operations.abortRequested,
    cooperativelyAborted: state.operations.cooperativelyAborted,
    activeAtReturn: state.operations.active,
  });
  if (drain.activeAtReturn !== 0 || drain.settled !== drain.admitted) {
    throw new Error("shadow batch returned before mandatory drain completed");
  }
  return Object.freeze({ deadline, drain });
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

function captureDependencyMethod<T extends (...args: never[]) => unknown>(
  dependency: unknown,
  method: string,
): T {
  if (
    (typeof dependency !== "object" && typeof dependency !== "function")
    || dependency === null
    || isProxy(dependency)
  ) throw new Error("invalid shadow batch dependency");
  let owner: object | null = dependency;
  while (owner) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, method);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        throw new Error("invalid shadow batch dependency");
      }
      return descriptor.value.bind(dependency) as T;
    }
    owner = Object.getPrototypeOf(owner);
  }
  throw new Error("invalid shadow batch dependency");
}

export async function runConversationV2ShadowBatch(input: {
  senderBarrier: SenderDrainAttempted;
  turns: readonly ShadowBatchTurn[];
  policyReader: ConversationEnginePolicyReader;
  evaluator: ShadowEvaluator;
  sink: ConversationV2ComparisonSink;
  approval: InternalV2ActivationApproval | null;
  runtimeIdentity: CycleIRuntimeBuildIdentity | null;
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
  const source = readDataRecord(input, [
    "senderBarrier",
    "turns",
    "policyReader",
    "evaluator",
    "sink",
    "approval",
    "runtimeIdentity",
    "maxTurns",
    "deadlineMs",
    "now",
    "recordConfig",
  ], "invalid shadow batch input");
  const canonicalRecordConfig = canonicalizeComparisonRecordConfig(source.recordConfig);
  const maxTurns = source.maxTurns;
  if (
    !Number.isSafeInteger(maxTurns)
    || (maxTurns as number) < 0
    || (maxTurns as number) > MAX_SHADOW_BATCH_TURNS
  ) throw new Error("invalid maxTurns bound");
  const deadlineMs = source.deadlineMs;
  if (
    !Number.isSafeInteger(deadlineMs)
    || (deadlineMs as number) < 0
    || (deadlineMs as number) > MAX_SHADOW_BATCH_DEADLINE_MS
  ) throw new Error("invalid deadlineMs bound");
  if (typeof source.now !== "function") throw new Error("invalid shadow batch clock");
  const now = source.now as () => number;
  const monotonicStartedAt = performance.now();
  let startedAt: number;
  let confirmedAt: number;
  try {
    startedAt = now();
    confirmedAt = now();
  } catch {
    throw new ShadowClockError("shadow batch clock must be finite and monotonic");
  }
  if (
    !Number.isFinite(startedAt)
    || !Number.isFinite(confirmedAt)
    || confirmedAt < startedAt
  ) throw new ShadowClockError("shadow batch clock must be finite and monotonic");
  const deadlineAt = startedAt + (deadlineMs as number);
  if (!Number.isFinite(deadlineAt)) throw new Error("invalid shadow batch deadline");
  const admission: AdmissionState = {
    now,
    startedAt,
    deadlineAt,
    deadlineMs: deadlineMs as number,
    monotonicStartedAt,
    lastClockSample: confirmedAt,
    clockStatus: "valid",
    admissionClosed: false,
    admissionClosedAt: null,
    operations: {
      admitted: 0,
      completed: 0,
      failed: 0,
      abortRequested: 0,
      cooperativelyAborted: 0,
      active: 0,
    },
  };
  const policyRead = captureDependencyMethod<
    (clinicId: string) => Promise<unknown>
  >(source.policyReader, "getConversationEnginePolicy");
  const evaluate = captureDependencyMethod<
    (reads: CapturedV2TurnReads, signal: AbortSignal) => Promise<ShadowEvaluation>
  >(source.evaluator, "evaluate");
  const append = captureDependencyMethod<
    (appendInput: Readonly<{ clinicId: string; record: LiveComparisonRecord }>) => Promise<void>
  >(source.sink, "append");
  const runtimeIdentity = source.runtimeIdentity as CycleIRuntimeBuildIdentity | null;
  if (runtimeIdentity !== null && !isRegisteredCycleIRuntimeBuildIdentity(runtimeIdentity)) {
    throw new Error("shadow batch runtime identity is not registered");
  }
  const senderBarrier = source.senderBarrier as SenderDrainAttempted;
  const turns = barrierBatches.get(senderBarrier);
  const barrierRegistered = barriers.has(senderBarrier);
  barriers.delete(senderBarrier);
  barrierBatches.delete(senderBarrier);
  if (
    !turns
    || turns !== source.turns
    || !barrierRegistered
  ) throw new Error("sender barrier is not registered for this batch snapshot");
  consumeBatchTurns(turns);
  const recordConfig = Object.freeze({
    hmacKey: canonicalRecordConfig.hmacKey,
    commit: canonicalRecordConfig.commit,
    datasetDigest: canonicalRecordConfig.datasetDigest,
    allowedModelIds: new Set(canonicalRecordConfig.allowedModelIds),
  });

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
  const selections: ShadowEngineSelection[] = [];

  const recordSelection = (
    turn: ShadowBatchTurn,
    selection: Readonly<{
      configuredEngine: ConversationEngine | null;
      effectiveRoute: "v1";
      shadow: boolean;
      reason: EffectiveConversationEngine["reason"] | "policy_unavailable";
    }>,
  ): void => {
    selections.push(Object.freeze({
      turnRef: keyedRef(turn.turn.turnId, recordConfig.hmacKey),
      clinicRef: keyedRef(turn.clinicId, recordConfig.hmacKey),
      automationMode: turn.automationMode,
      ...selection,
    }));
  };

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    if (index >= (maxTurns as number)) {
      summary.skipped += turns.length - index;
      summary.maxTurnsReached = true;
      break;
    }
    if (!observeAdmission(admission)) {
      summary.skipped += turns.length - index;
      summary.deadlineReached = true;
      break;
    }

    if (turn.automationMode !== "live") {
      recordSelection(turn, {
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
      const rawPolicy = await settleStartedDependency(
        admission,
        "policy_read",
        () => policyRead(turn.clinicId),
      );
      const policy = canonicalizeConversationEnginePolicy(rawPolicy, turn.clinicId);
      const effective = resolveConversationEngine({
        automationMode: turn.automationMode,
        policy,
        approval: source.approval as InternalV2ActivationApproval | null,
        runtimeIdentity,
      });
      recordSelection(turn, {
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
      recordSelection(turn, {
        configuredEngine: null,
        effectiveRoute: "v1",
        shadow: false,
        reason: "policy_unavailable",
      });
    }
    if (!observeAdmission(admission)) {
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
          admission,
          "provider_call",
          (signal) => evaluate(reads, signal),
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
        admission,
        "comparison_write",
        () => append({ clinicId: turn.clinicId, record }),
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
    if (!observeAdmission(admission)) {
      summary.deadlineReached = true;
      summary.skipped += turns.length - index - 1;
      break;
    }
  }

  const deadlineFacts = finalizeAdmission(admission);
  summary.deadlineReached = deadlineFacts.deadline.admissionClosed;
  return Object.freeze({
    ...summary,
    ...deadlineFacts,
    selections: Object.freeze(selections),
  });
}
