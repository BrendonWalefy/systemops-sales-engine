import type {
  ReplayScenarioMode,
  ReplayScenarioV1,
} from "@/application/replay/contracts";
import { buildReplayExecutionGroups } from "@/application/replay/replay-execution-plan";

export type ExecutableReplayScenarioMode = Extract<
  ReplayScenarioMode,
  "closed_loop" | "concurrency"
>;

export type ReplayScenarioRequest = {
  runId: string;
  mode: ExecutableReplayScenarioMode;
  scenario: ReplayScenarioV1;
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

  return input as ReplayScenarioRequest;
}
