import type {
  ReplayGoldenExpectationsV1,
  ReplayScenarioMode,
  ReplayScenarioV1,
  ReplayCalendarSnapshotV1,
} from "@/application/replay/contracts";
import { REPLAY_GOLDEN_OUTBOUND_KINDS } from "@/application/replay/contracts";
import { buildReplayExecutionGroups } from "@/application/replay/replay-execution-plan";
import {
  DECISION_TRACE_STAGES,
  type DecisionTraceStage,
} from "@/core/observability/DecisionTrace";

const decisionTraceStages = new Set<string>(DECISION_TRACE_STAGES);
const replayOutboundKinds = new Set<string>(REPLAY_GOLDEN_OUTBOUND_KINDS);

export type ExecutableReplayScenarioMode = Extract<
  ReplayScenarioMode,
  "closed_loop" | "concurrency"
>;

export type ReplayScenarioRequest = {
  runId: string;
  mode: ExecutableReplayScenarioMode;
  scenario: ReplayScenarioV1;
  calendarSnapshot?: ReplayCalendarSnapshotV1;
};

export function assertReplayScenarioRequest(
  value: unknown,
): ReplayScenarioRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid replay request");
  }

  const input = value as Partial<ReplayScenarioRequest>;
  if (
    typeof input.runId !== "string" ||
    !/^[a-zA-Z0-9._:-]{4,160}$/.test(input.runId) ||
    (input.mode !== "closed_loop" && input.mode !== "concurrency") ||
    !input.scenario ||
    input.scenario.schemaVersion !== "replay-scenario.v1" ||
    !Array.isArray(input.scenario.turns) ||
    input.scenario.turns.length === 0
  ) {
    throw new Error("Invalid replay scenario request");
  }

  const mode = input.mode;
  if (!input.scenario.compatibleModes.includes(mode)) {
    throw new Error(`Replay scenario is not compatible with mode=${mode}`);
  }

  const leadTurnCount = input.scenario.turns.filter(
    (turn) => turn.author === "lead",
  ).length;
  if (leadTurnCount === 0) {
    throw new Error("Replay scenario has no lead turns");
  }
  if (mode === "concurrency" && leadTurnCount < 2) {
    throw new Error("Concurrency replay requires at least two lead turns");
  }
  if (
    mode === "concurrency" &&
    !buildReplayExecutionGroups(input.scenario, mode).some(
      (group) => group.length > 1,
    )
  ) {
    throw new Error("Concurrency replay requires a consecutive lead burst");
  }
  if (input.scenario.expectations !== undefined) {
    assertReplayGoldenExpectations(input.scenario.expectations);
  }

  return input as ReplayScenarioRequest;
}

function assertReplayGoldenExpectations(
  value: unknown,
): asserts value is ReplayGoldenExpectationsV1 {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid replay golden expectations");
  }

  const expectations = value as Partial<ReplayGoldenExpectationsV1>;
  if (
    expectations.schemaVersion !== "replay-golden-expectations.v1" ||
    !isTraceStageList(expectations.requiredTraceStages) ||
    !isTraceStageList(expectations.forbiddenTraceStages) ||
    hasTraceStageConflict(
      expectations.requiredTraceStages,
      expectations.forbiddenTraceStages,
    ) ||
    !isFinalConversation(expectations.finalConversation) ||
    (expectations.finalState !== null && typeof expectations.finalState !== "string") ||
    !isOutboundExpectation(expectations.outbound) ||
    !isCalendarExpectation(expectations.calendar)
  ) {
    throw new Error("Invalid replay golden expectations");
  }
}

function hasTraceStageConflict(
  requiredTraceStages: DecisionTraceStage[],
  forbiddenTraceStages: DecisionTraceStage[],
): boolean {
  const forbidden = new Set<DecisionTraceStage>(forbiddenTraceStages);
  return requiredTraceStages.some((stage) => forbidden.has(stage));
}

function isTraceStageList(value: unknown): value is DecisionTraceStage[] {
  return Array.isArray(value) && value.every(
    (stage) => typeof stage === "string" && decisionTraceStages.has(stage),
  );
}

function isFinalConversation(
  value: unknown,
): value is ReplayGoldenExpectationsV1["finalConversation"] {
  if (!value || typeof value !== "object") return false;
  const finalConversation = value as Record<string, unknown>;
  return isBooleanOrNull(finalConversation.aiPaused) &&
    isBooleanOrNull(finalConversation.needsAttention);
}

function isOutboundExpectation(
  value: unknown,
): value is ReplayGoldenExpectationsV1["outbound"] {
  if (!value || typeof value !== "object") return false;
  const outbound = value as Record<string, unknown>;
  return isNonNegativeInteger(outbound.minEffects) &&
    isNonNegativeInteger(outbound.maxEffects) &&
    outbound.minEffects <= outbound.maxEffects &&
    Array.isArray(outbound.requiredKinds) &&
    outbound.requiredKinds.every(
      (kind) => typeof kind === "string" && replayOutboundKinds.has(kind),
    );
}

function isCalendarExpectation(
  value: unknown,
): value is ReplayGoldenExpectationsV1["calendar"] {
  return Boolean(
    value &&
    typeof value === "object" &&
    isNonNegativeInteger((value as Record<string, unknown>).maxWriteEffects),
  );
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
