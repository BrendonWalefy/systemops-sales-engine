import { describe, expect, it, vi } from "vitest";
import { RegisterInboundHistory } from "@/application/conversation/register-inbound-history";

const authority = {
  streamId: "stream-1",
  streamGeneration: 2,
  inboundEventId: "event-2",
};

const message = {
  channel: "whatsapp" as const,
  externalContactId: "5511999999999",
  externalThreadId: "5511999999999",
  externalMessageId: "provider-message-2",
  name: "Lead",
  phone: "5511999999999",
  whatsappLid: null,
  email: null,
  body: "B",
  receivedAt: new Date("2026-08-24T12:00:05.000Z"),
  campaignId: null,
};

describe("canonical WhatsApp stream history", () => {
  it("prepares the canonical row and binds its exact stream before any claimed effects", async () => {
    const prepared = {
      messageInserted: true,
      authorityMatchedExisting: false,
      conversation: { id: "conversation-1" },
    };
    const prepareInboundHistory = vi.fn().mockResolvedValue(prepared);
    const applyClaimedInboundEffects = vi.fn();
    const bindStreamToConversation = vi.fn().mockResolvedValue({});
    const registrar = new RegisterInboundHistory({
      registerIncomingMessage: {
        prepareInboundHistory,
        applyClaimedInboundEffects,
      } as never,
      streamAuthority: { bindStreamToConversation },
      now: () => new Date("2026-08-24T12:00:20.000Z"),
    });

    await expect(registrar.prepare({ clinicId: "clinic-1", message, authority }))
      .resolves.toBe(prepared);
    expect(prepareInboundHistory).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      message,
      inboundAuthority: authority,
    });
    expect(bindStreamToConversation).toHaveBeenCalledWith({
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      ...authority,
      now: new Date("2026-08-24T12:00:20.000Z"),
    });
    expect(applyClaimedInboundEffects).not.toHaveBeenCalled();
  });

  it("rebinds an idempotently matched retry but not an unrelated duplicate", async () => {
    const bindStreamToConversation = vi.fn().mockResolvedValue({});
    const prepareInboundHistory = vi.fn()
      .mockResolvedValueOnce({
        messageInserted: false,
        authorityMatchedExisting: true,
        conversation: { id: "conversation-1" },
      })
      .mockResolvedValueOnce({
        messageInserted: false,
        authorityMatchedExisting: false,
        conversation: { id: "conversation-1" },
      });
    const registrar = new RegisterInboundHistory({
      registerIncomingMessage: { prepareInboundHistory } as never,
      streamAuthority: { bindStreamToConversation },
      now: () => new Date("2026-08-24T12:00:20.000Z"),
    });

    await registrar.prepare({ clinicId: "clinic-1", message, authority });
    await registrar.prepare({ clinicId: "clinic-1", message, authority });
    expect(bindStreamToConversation).toHaveBeenCalledTimes(1);
  });
});
