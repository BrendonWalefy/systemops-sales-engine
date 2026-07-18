import { describe, expect, it, vi } from "vitest";
import { deliverRecoveryMessage } from "@/application/conversations/recovery-delivery";

describe("deliverRecoveryMessage", () => {
  it("reports a delivery failure and skips bookkeeping when the channel rejects the message", async () => {
    const persistMessage = vi.fn(async () => undefined);
    const resumeConversation = vi.fn(async () => undefined);
    const markRecoveryComplete = vi.fn(async () => undefined);

    const result = await deliverRecoveryMessage({
      send: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
      persistMessage,
      resumeConversation,
      markRecoveryComplete,
    });

    expect(result).toEqual({
      ok: false,
      error: "WhatsApp send failed — mensagem não entregue",
    });
    expect(persistMessage).not.toHaveBeenCalled();
    expect(resumeConversation).not.toHaveBeenCalled();
    expect(markRecoveryComplete).not.toHaveBeenCalled();
  });

  it("keeps the send successful when follow-up bookkeeping fails after delivery", async () => {
    const onBookkeepingError = vi.fn();

    const result = await deliverRecoveryMessage({
      send: vi.fn(async () => "provider-message-id"),
      persistMessage: vi.fn(async () => undefined),
      resumeConversation: vi.fn(async () => undefined),
      markRecoveryComplete: vi.fn(async () => {
        throw new Error("follow-up conflict");
      }),
      onBookkeepingError,
    });

    expect(result).toEqual({ ok: true });
    expect(onBookkeepingError).toHaveBeenCalledWith(
      "follow_up_completion",
      expect.any(Error),
    );
  });
});
