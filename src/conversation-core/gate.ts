export type TurnGateInput = {
  automationEnabled: boolean;
  duplicate: boolean;
  humanControlled: boolean;
  optedOut: boolean;
};

export type TurnGateResult =
  | { outcome: "proceed" }
  | { outcome: "suppress"; reason: "disabled" | "duplicate" | "human_controlled" | "opted_out" };

export function evaluateTurnGate(input: TurnGateInput): TurnGateResult {
  if (!input.automationEnabled) return { outcome: "suppress", reason: "disabled" };
  if (input.duplicate) return { outcome: "suppress", reason: "duplicate" };
  if (input.humanControlled) return { outcome: "suppress", reason: "human_controlled" };
  if (input.optedOut) return { outcome: "suppress", reason: "opted_out" };
  return { outcome: "proceed" };
}
