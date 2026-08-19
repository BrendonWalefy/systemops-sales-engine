import { describe, expect, it } from "vitest";
import {
  V2_SAFE_FAILURE_REPLY_TEXT,
  shouldEnqueueSafeFailureReply,
} from "@/application/conversation-v2/v2-safe-failure-reply";

const base = {
  reason: "understanding_failed",
  effectAttempted: false,
  replyAlreadyEnqueued: false,
  configurationResolved: true,
} as const;

describe("V2 safe failure reply", () => {
  it("answers the lead when the turn dies before any effect", () => {
    expect(shouldEnqueueSafeFailureReply(base)).toBe(true);
    expect(shouldEnqueueSafeFailureReply({ ...base, reason: "decision_failed" })).toBe(true);
  });

  it("stays silent when the outbox itself is the failure", () => {
    expect(shouldEnqueueSafeFailureReply({ ...base, reason: "outbox_failed" })).toBe(false);
  });

  it("stays silent once a real effect was attempted", () => {
    expect(shouldEnqueueSafeFailureReply({ ...base, reason: "action_failed", effectAttempted: true }))
      .toBe(false);
  });

  it("never duplicates a reply the turn already enqueued", () => {
    expect(shouldEnqueueSafeFailureReply({ ...base, replyAlreadyEnqueued: true })).toBe(false);
  });

  it("stays silent without a resolved delivery configuration", () => {
    expect(shouldEnqueueSafeFailureReply({ ...base, configurationResolved: false })).toBe(false);
  });

  it("promises nothing the system has not decided", () => {
    const text = V2_SAFE_FAILURE_REPLY_TEXT.toLowerCase();
    for (const forbidden of ["r$", "preço", "valor", "horário", "agendad", "equipe", "amanhã", "desconto"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(V2_SAFE_FAILURE_REPLY_TEXT.length).toBeLessThanOrEqual(160);
    expect((V2_SAFE_FAILURE_REPLY_TEXT.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
  });
});
