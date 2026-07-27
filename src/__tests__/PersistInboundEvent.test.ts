import { describe, expect, it, vi } from "vitest";
import { persistInboundEventAndEnqueue } from "@/application/whatsapp/persist-inbound-event";
import { buildZApiInboundEvent } from "@/infrastructure/adapters/channels/whatsapp/zapi-inbound-event";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

function payload(overrides: Partial<ZApiInboundPayload> = {}): ZApiInboundPayload {
  return {
    phone: "5511999999999",
    instanceId: "instance-1",
    messageId: "message-1",
    momment: 1_719_144_000_000,
    status: "RECEIVED_MESSAGE",
    chatName: "Lead",
    senderName: "Lead",
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe: false,
    ...overrides,
  };
}

describe("persistInboundEventAndEnqueue", () => {
  it("prefere a persistência atômica quando o store durável a oferece", async () => {
    const recordInboundEventAndEnqueue = vi.fn().mockResolvedValue({
      inboundEventId: "event-atomic",
      eventWasNew: true,
      jobWasNew: true,
    });
    const recordInboundEvent = vi.fn();
    const enqueueJob = vi.fn();

    const result = await persistInboundEventAndEnqueue(
      buildZApiInboundEvent({ clinicId: "clinic-1", payload: payload() }),
      {
        inboundEventStore: {
          recordInboundEventAndEnqueue,
          recordInboundEvent,
        } as never,
        jobQueue: { enqueueJob } as never,
      },
    );

    expect(result).toEqual({
      inboundEventId: "event-atomic",
      eventWasNew: true,
      jobWasNew: true,
    });
    expect(recordInboundEvent).not.toHaveBeenCalled();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("enfileira message.process para um inbound novo", async () => {
    const recordInboundEvent = vi.fn().mockResolvedValue({
      event: { id: "event-1" },
      isNew: true,
    });
    const enqueueJob = vi.fn().mockResolvedValue({ isNew: true });

    const result = await persistInboundEventAndEnqueue(
      buildZApiInboundEvent({ clinicId: "clinic-1", payload: payload({ text: { message: " Olá " } }) }),
      {
        inboundEventStore: { recordInboundEvent } as never,
        jobQueue: { enqueueJob } as never,
      },
    );

    expect(recordInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "z_api",
        providerMessageId: "message-1",
        conversationKey: "5511999999999",
        normalizedText: "Olá",
      }),
    );
    expect(enqueueJob).toHaveBeenCalledWith({
      queue: "message.process",
      payload: { inboundEventId: "event-1" },
      dedupeKey: "inbound-event:event-1",
    });
    expect(result).toEqual({ inboundEventId: "event-1", eventWasNew: true, jobWasNew: true });
  });

  it("reenfileira duplicata por provider message id quando o job anterior não foi criado", async () => {
    const recordInboundEvent = vi.fn().mockResolvedValue({
      event: { id: "event-1" },
      isNew: false,
    });
    const enqueueJob = vi.fn().mockResolvedValue({ isNew: true });

    await persistInboundEventAndEnqueue(
      buildZApiInboundEvent({ clinicId: "clinic-1", payload: payload() }),
      {
        inboundEventStore: { recordInboundEvent } as never,
        jobQueue: { enqueueJob } as never,
      },
    );

    expect(enqueueJob).toHaveBeenCalledOnce();
  });

  it("preserva payload sem texto para processamento posterior", () => {
    const event = buildZApiInboundEvent({
      clinicId: "clinic-1",
      payload: payload({ messageId: "message-without-text" }),
      now: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(event).toMatchObject({
      providerMessageId: "message-without-text",
      normalizedText: null,
      mediaType: null,
    });
  });

});
