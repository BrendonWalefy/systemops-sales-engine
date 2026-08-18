export type DentalStructuredInput =
  | { kind: "command"; command: string }
  | { kind: "menu"; selectedId: string; allowedIds: readonly string[] }
  | { kind: "pending_option"; pendingStepId: string; optionId: string; offeredOptionIds: readonly string[] };

export type DentalStructuredEvent =
  | { type: "reset_requested" }
  | { type: "menu_requested"; itemId: string }
  | { type: "pending_option_selected"; pendingStepId: string; optionId: string };

export function resolveDentalStructuredInput(input: DentalStructuredInput): DentalStructuredEvent | null {
  if (input.kind === "command") return input.command === "/reset" ? { type: "reset_requested" } : null;
  if (input.kind === "menu") return input.allowedIds.includes(input.selectedId) ? { type: "menu_requested", itemId: input.selectedId } : null;
  return input.offeredOptionIds.includes(input.optionId)
    ? { type: "pending_option_selected", pendingStepId: input.pendingStepId, optionId: input.optionId }
    : null;
}
