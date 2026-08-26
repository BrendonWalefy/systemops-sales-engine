export const LIVE_OUTBOUND_PREFLIGHT_REASONS = [
  "authority_below_v2",
  "claim_mismatch",
  "clinic_not_active",
  "auto_reply_disabled",
  "tenant_live_disabled",
  "shadow_observe",
  "human_takeover",
  "consent_revoked",
  "opted_out",
  "safety_blocked",
  "global_kill_switch",
  "outbound_not_sendable",
] as const;

export type LiveOutboundPreflightReason =
  (typeof LIVE_OUTBOUND_PREFLIGHT_REASONS)[number];

export type LiveOutboundPreflightResult =
  | Readonly<{ authorized: true }>
  | Readonly<{ authorized: false; reason: LiveOutboundPreflightReason }>;

export interface LiveOutboundPreflight {
  authorizeOutboundMessageForSend(id: string): Promise<LiveOutboundPreflightResult>;
}

export class LiveOutboundCreationRejectedError extends Error {
  readonly code = "live_outbound_creation_rejected";

  constructor(readonly reason: LiveOutboundPreflightReason) {
    super(`Live outbound creation rejected: ${reason}`);
    this.name = "LiveOutboundCreationRejectedError";
  }
}

export function isLiveOutboundPreflightReason(
  value: unknown,
): value is LiveOutboundPreflightReason {
  return typeof value === "string"
    && (LIVE_OUTBOUND_PREFLIGHT_REASONS as readonly string[]).includes(value);
}
