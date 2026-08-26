import { describe, expect, it } from "vitest";
import {
  isV2TerminalHandoffRequiredError,
  resolveV2TerminalFailure,
  V2TerminalHandoffRequiredError,
} from "@/application/conversation-v2/v2-terminal-failure-policy";

describe("resolveV2TerminalFailure", () => {
  it("retries the same durable turn while the process budget remains", () => {
    expect(resolveV2TerminalFailure({
      attempt: 2,
      maxAttempts: 3,
      effectState: "attempted",
      safeReplyState: "unavailable",
    })).toBe("retry_same_turn");
  });

  it("completes an already-enqueued safe response without another retry", () => {
    expect(resolveV2TerminalFailure({
      attempt: 1,
      maxAttempts: 3,
      effectState: "none",
      safeReplyState: "enqueued",
    })).toBe("complete_safe_reply");
  });

  it("permits one deterministic safe response at exhaustion before effects", () => {
    expect(resolveV2TerminalFailure({
      attempt: 3,
      maxAttempts: 3,
      effectState: "none",
      safeReplyState: "available",
    })).toBe("complete_safe_reply");
  });

  it("requires durable handoff at exhaustion after an effect or without a safe response", () => {
    expect(resolveV2TerminalFailure({
      attempt: 3,
      maxAttempts: 3,
      effectState: "completed",
      safeReplyState: "unavailable",
    })).toBe("handoff_required");
    expect(resolveV2TerminalFailure({
      attempt: 3,
      maxAttempts: 3,
      effectState: "none",
      safeReplyState: "unavailable",
    })).toBe("handoff_required");
  });

  it("recognizes only the closed persisted handoff marker", () => {
    const error = new V2TerminalHandoffRequiredError("effect_outbox_failed");
    expect(error.message).toBe("v2_terminal_handoff_required:effect_outbox_failed");
    expect(isV2TerminalHandoffRequiredError(error)).toBe(true);
    expect(isV2TerminalHandoffRequiredError(error.message)).toBe(true);
    expect(isV2TerminalHandoffRequiredError(
      new V2TerminalHandoffRequiredError("delivery_outcome_indeterminate"),
    )).toBe(true);
    expect(isV2TerminalHandoffRequiredError("database unavailable")).toBe(false);
  });
});
