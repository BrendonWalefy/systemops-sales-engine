import type {
  ReplayScenarioMode,
  ReplayScenarioTurnV1,
  ReplayScenarioV1,
} from "@/application/replay/contracts";

type ExecutableReplayScenarioMode = Extract<
  ReplayScenarioMode,
  "closed_loop" | "concurrency"
>;

export const REPLAY_BURST_WINDOW_MS = 5_000;

/**
 * Preserva turnos isolados como execuções sequenciais e agrupa somente mensagens
 * consecutivas do lead que realmente formam uma rajada. Uma resposta histórica
 * do agente ou operador encerra a rajada; ela é evidência, não input do replay.
 */
export function buildReplayExecutionGroups(
  scenario: ReplayScenarioV1,
  mode: ExecutableReplayScenarioMode,
): ReplayScenarioTurnV1[][] {
  if (mode === "closed_loop") {
    return scenario.turns
      .filter((turn) => turn.author === "lead")
      .map((turn) => [turn]);
  }

  const groups: ReplayScenarioTurnV1[][] = [];
  let currentGroup: ReplayScenarioTurnV1[] | null = null;
  let previousTurn: ReplayScenarioTurnV1 | null = null;

  for (const turn of scenario.turns) {
    if (turn.author !== "lead") {
      currentGroup = null;
      previousTurn = turn;
      continue;
    }

    const continuesBurst =
      currentGroup !== null &&
      previousTurn?.author === "lead" &&
      turn.offsetMs - previousTurn.offsetMs <= REPLAY_BURST_WINDOW_MS;
    if (continuesBurst && currentGroup) {
      currentGroup.push(turn);
    } else {
      currentGroup = [turn];
      groups.push(currentGroup);
    }
    previousTurn = turn;
  }

  return groups;
}
