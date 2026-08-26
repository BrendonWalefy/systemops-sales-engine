export type V2TerminalFailureResolution =
  | "retry_same_turn"
  | "complete_safe_reply"
  | "handoff_required";

export type V2TerminalHandoffReason =
  | "v2_terminal_processing_failure"
  | "v2_terminal_delivery_failure";

export type V2TerminalHandoffRequiredReason =
  | "effect_outbox_failed"
  | "delivery_outcome_indeterminate";

const V2_TERMINAL_HANDOFF_REQUIRED_MARKERS = {
  effect_outbox_failed: "v2_terminal_handoff_required:effect_outbox_failed",
  delivery_outcome_indeterminate:
    "v2_terminal_handoff_required:delivery_outcome_indeterminate",
} as const satisfies Record<V2TerminalHandoffRequiredReason, string>;

export class V2TerminalHandoffRequiredError extends Error {
  override readonly name = "V2TerminalHandoffRequiredError";

  constructor(reason: V2TerminalHandoffRequiredReason) {
    super(V2_TERMINAL_HANDOFF_REQUIRED_MARKERS[reason]);
  }
}

export function isV2TerminalHandoffRequiredError(value: unknown): boolean {
  return getV2TerminalHandoffRequiredReason(value) !== null;
}

export function getV2TerminalHandoffRequiredReason(
  value: unknown,
): V2TerminalHandoffRequiredReason | null {
  const message = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : null;
  if (message === V2_TERMINAL_HANDOFF_REQUIRED_MARKERS.effect_outbox_failed) {
    return "effect_outbox_failed";
  }
  if (message === V2_TERMINAL_HANDOFF_REQUIRED_MARKERS.delivery_outcome_indeterminate) {
    return "delivery_outcome_indeterminate";
  }
  return null;
}

export type V2TerminalHandoffStore = Readonly<{
  markForInboundEvent(input: Readonly<{
    clinicId: string;
    inboundEventId: string;
    claimJobId: string;
    reason: "v2_terminal_processing_failure";
    now: Date;
  }>): Promise<boolean>;
  markForOutboundMessage(input: Readonly<{
    outboundMessageId: string;
    sendJobId: string;
    workerId: string;
    reason: "v2_terminal_delivery_failure";
    now: Date;
  }>): Promise<boolean>;
}>;

export function resolveV2TerminalFailure(input: Readonly<{
  attempt: number;
  maxAttempts: number;
  effectState: "none" | "attempted" | "completed";
  safeReplyState: "unavailable" | "available" | "enqueued";
}>): V2TerminalFailureResolution {
  if (input.safeReplyState === "enqueued") return "complete_safe_reply";
  if (input.attempt < input.maxAttempts) return "retry_same_turn";
  if (input.effectState === "none" && input.safeReplyState === "available") {
    return "complete_safe_reply";
  }
  return "handoff_required";
}
