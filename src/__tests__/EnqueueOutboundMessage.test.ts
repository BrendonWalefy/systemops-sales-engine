import { describe, expect, it, vi } from "vitest";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";

describe("enqueueOutboundMessage", () => {
  it("prefere a criação atômica de outbox e job quando disponível", async () => {
    const createOutboundMessageAndEnqueue = vi.fn().mockResolvedValue({
      outboundMessageId: "outbound-atomic",
      messageWasNew: true,
      jobWasNew: true,
    });
    const createOutboundMessage = vi.fn();
    const enqueueJob = vi.fn();

    const result = await enqueueOutboundMessage(
      {
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        channel: "whatsapp",
        payload: { turnId: "turn-atomic" },
        deliveryKind: "text",
      },
      {
        outboundMessageStore: {
          createOutboundMessageAndEnqueue,
          createOutboundMessage,
        } as never,
        jobQueue: { enqueueJob } as never,
      },
    );

    expect(createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.any(Object),
      { turnId: "turn-atomic" },
    );
    expect(result.outboundMessageId).toBe("outbound-atomic");
    expect(createOutboundMessage).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

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

  it("propaga o turnId para o job de entrega sem alterar a outbox", async () => {
    const createOutboundMessage = vi.fn().mockResolvedValue({
      message: { id: "outbound-1" },
      isNew: true,
    });
    const enqueueJob = vi.fn().mockResolvedValue({ isNew: true });
    const input = {
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      channel: "whatsapp" as const,
      payload: { turnId: "turn-1" },
      deliveryKind: "text" as const,
    };

    await enqueueOutboundMessage(input, {
      outboundMessageStore: { createOutboundMessage } as never,
      jobQueue: { enqueueJob } as never,
    });

    expect(createOutboundMessage).toHaveBeenCalledWith(input);
    expect(enqueueJob).toHaveBeenCalledWith({
      queue: "message.send",
      payload: { outboundMessageId: "outbound-1", turnId: "turn-1" },
      dedupeKey: "outbound-message:outbound-1",
    });
  });
});
