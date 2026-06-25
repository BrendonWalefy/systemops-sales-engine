import { describe, expect, it, vi } from "vitest";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";

describe("enqueueOutboundMessage", () => {
  it("recria o job idempotente quando uma outbox já persistida é reencontrada", async () => {
    const createOutboundMessage = vi.fn().mockResolvedValue({
      message: { id: "outbound-1" },
      isNew: false,
    });
    const enqueueJob = vi.fn().mockResolvedValue({ isNew: true });

    const result = await enqueueOutboundMessage(
      {
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        channel: "whatsapp",
        payload: {},
        deliveryKind: "text",
        dedupeKey: "agent-message:agent-1",
      },
      {
        outboundMessageStore: { createOutboundMessage } as never,
        jobQueue: { enqueueJob } as never,
      },
    );

    expect(enqueueJob).toHaveBeenCalledWith({
      queue: "message.send",
      payload: { outboundMessageId: "outbound-1" },
      dedupeKey: "outbound-message:outbound-1",
    });
    expect(result).toEqual({ outboundMessageId: "outbound-1", messageWasNew: false, jobWasNew: true });
  });
});
