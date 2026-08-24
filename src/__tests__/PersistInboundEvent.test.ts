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
  it("delegates ledger, stream generation, and job creation to the one atomic store boundary", async () => {
    const persisted = {
      outcome: "registered" as const,
      inboundEventId: "event-atomic",
      streamId: "stream-1",
      streamGeneration: 1,
      jobId: "job-1",
      eventWasNew: true,
      jobWasNew: true,
    };
    const recordInboundEventAndEnqueue = vi.fn().mockResolvedValue(persisted);
    const input = buildZApiInboundEvent({ clinicId: "clinic-1", payload: payload() });

    const result = await persistInboundEventAndEnqueue(input, {
      inboundEventStore: { recordInboundEventAndEnqueue } as never,
    });

    expect(result).toEqual(persisted);
    expect(recordInboundEventAndEnqueue).toHaveBeenCalledOnce();
    expect(recordInboundEventAndEnqueue).toHaveBeenCalledWith(input);
  });

  it("forwards normalized phone and provider-thread aliases without a queue fallback", async () => {
    const receivedAt = new Date("2026-06-23T12:00:00.000Z");
    const recordInboundEventAndEnqueue = vi.fn().mockResolvedValue({
      outcome: "registered",
      inboundEventId: "event-1",
      streamId: "stream-1",
      streamGeneration: 1,
      jobId: "job-1",
      eventWasNew: true,
      jobWasNew: true,
    });

    await persistInboundEventAndEnqueue(buildZApiInboundEvent({
      clinicId: "clinic-1",
      payload: payload({ text: { message: " Olá " }, momment: receivedAt.getTime() }),
    }), {
      inboundEventStore: { recordInboundEventAndEnqueue } as never,
    });

    expect(recordInboundEventAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      provider: "z_api",
      providerMessageId: "message-1",
      conversationKey: "5511999999999",
      normalizedText: "Olá",
      mediaType: null,
      receivedAt,
      aliases: [
        {
          kind: "phone",
          providerScope: "__provider_independent__",
          normalizedValue: "5511999999999",
        },
        {
          kind: "provider_thread",
          providerScope: "z_api:instance-1",
          normalizedValue: "5511999999999",
        },
      ],
    }));
  });

  it("returns the store's persisted identity-conflict result without creating a fallback job", async () => {
    const conflict = {
      outcome: "identity_conflict" as const,
      inboundEventId: "event-conflict",
      jobId: null,
      eventWasNew: true,
      jobWasNew: false as const,
    };
    const recordInboundEventAndEnqueue = vi.fn().mockResolvedValue(conflict);

    const result = await persistInboundEventAndEnqueue(
      buildZApiInboundEvent({ clinicId: "clinic-1", payload: payload() }),
      { inboundEventStore: { recordInboundEventAndEnqueue } as never },
    );

    expect(result).toEqual(conflict);
  });

  it("preserves payload without text for later canonical processing", () => {
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
