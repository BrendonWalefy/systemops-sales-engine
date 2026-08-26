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
    const requestSenderWake = vi.fn().mockResolvedValue(undefined);
    const scheduled: Array<() => Promise<void>> = [];

    const result = await enqueueOutboundMessage(
      {
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        channel: "whatsapp",
        payload: { turnId: "turn-atomic" },
        deliveryKind: "text",
        authorization: { kind: "legacy" },
      },
      ({
        outboundMessageStore: {
          createOutboundMessageAndEnqueue,
          createOutboundMessage,
        } as never,
        jobQueue: { enqueueJob } as never,
        requestSenderWake,
        scheduleSenderWake: (task: () => Promise<void>) => scheduled.push(task),
      } as never),
    );

    expect(createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.any(Object),
      { turnId: "turn-atomic" },
    );
    expect(result.outboundMessageId).toBe("outbound-atomic");
    expect(createOutboundMessage).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
    expect(requestSenderWake).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]!();
    expect(requestSenderWake).toHaveBeenCalledOnce();
  });

  it("não acorda o sender quando o job deduplicado já existia", async () => {
    const requestSenderWake = vi.fn().mockResolvedValue(undefined);
    const result = await enqueueOutboundMessage(
      {
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        channel: "whatsapp",
        payload: { turnId: "turn-duplicate" },
        deliveryKind: "text",
        authorization: { kind: "legacy" },
      },
      ({
        outboundMessageStore: {
          createOutboundMessageAndEnqueue: vi.fn().mockResolvedValue({
            outboundMessageId: "outbound-existing",
            messageWasNew: false,
            jobWasNew: false,
          }),
        } as never,
        jobQueue: {} as never,
        requestSenderWake,
      } as never),
    );

    expect(result.jobWasNew).toBe(false);
    expect(requestSenderWake).not.toHaveBeenCalled();
  });

  it("não desfaz a outbox autorizada quando o wake do sender falha", async () => {
    const requestSenderWake = vi.fn().mockRejectedValue(new Error("wake unavailable"));
    const scheduled: Array<() => Promise<void>> = [];

    await expect(enqueueOutboundMessage(
      {
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        channel: "whatsapp",
        payload: { turnId: "turn-1" },
        deliveryKind: "text",
        authorization: { kind: "legacy" },
      },
      ({
        outboundMessageStore: {
          createOutboundMessageAndEnqueue: vi.fn().mockResolvedValue({
            outboundMessageId: "outbound-1",
            messageWasNew: true,
            jobWasNew: true,
          }),
        } as never,
        jobQueue: {} as never,
        requestSenderWake,
        scheduleSenderWake: (task: () => Promise<void>) => scheduled.push(task),
      } as never),
    )).resolves.toMatchObject({ outboundMessageId: "outbound-1", jobWasNew: true });
    expect(scheduled).toHaveLength(1);
    await expect(scheduled[0]!()).resolves.toBeUndefined();
    expect(requestSenderWake).toHaveBeenCalledOnce();
  });

  it("returns committed business work before a slow sender wake starts", async () => {
    const requestSenderWake = vi.fn().mockResolvedValue(undefined);
    const scheduled: Array<() => Promise<void>> = [];

    const result = await enqueueOutboundMessage(
      {
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        channel: "whatsapp",
        payload: { turnId: "turn-post-response" },
        deliveryKind: "text",
        authorization: { kind: "legacy" },
      },
      ({
        outboundMessageStore: {
          createOutboundMessageAndEnqueue: vi.fn().mockResolvedValue({
            outboundMessageId: "outbound-post-response",
            messageWasNew: true,
            jobWasNew: true,
          }),
        } as never,
        jobQueue: {} as never,
        requestSenderWake,
        scheduleSenderWake: (task: () => Promise<void>) => scheduled.push(task),
      } as never),
    );

    expect(result.outboundMessageId).toBe("outbound-post-response");
    expect(requestSenderWake).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
  });

  it("keeps committed business work when post-response scheduling is unavailable", async () => {
    const requestSenderWake = vi.fn();

    await expect(enqueueOutboundMessage(
      {
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        channel: "whatsapp",
        payload: { turnId: "turn-no-request-scope" },
        deliveryKind: "text",
        authorization: { kind: "legacy" },
      },
      ({
        outboundMessageStore: {
          createOutboundMessageAndEnqueue: vi.fn().mockResolvedValue({
            outboundMessageId: "outbound-no-request-scope",
            messageWasNew: true,
            jobWasNew: true,
          }),
        } as never,
        jobQueue: {} as never,
        requestSenderWake,
        scheduleSenderWake: () => { throw new Error("outside request scope"); },
      } as never),
    )).resolves.toMatchObject({
      outboundMessageId: "outbound-no-request-scope",
      jobWasNew: true,
    });
    expect(requestSenderWake).not.toHaveBeenCalled();
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
        authorization: { kind: "legacy" },
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
      maxAttempts: 10,
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
      authorization: { kind: "legacy" as const },
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
      maxAttempts: 10,
    });
  });
});
