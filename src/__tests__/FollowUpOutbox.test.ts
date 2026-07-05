import { describe, expect, it, vi } from "vitest";
import { buildFollowUpOutboxInput } from "@/app/api/cron/follow-up-dispatcher/route";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import type { OutboundMessage } from "@/application/ports/outbound-message-store";

const ttsConfig = { provider: "nova", speed: 0.92 } as const;

function makeFollowUpInput() {
  return buildFollowUpOutboxInput({
    clinicId: "clinic-1",
    conversationId: "conversation-1",
    followUpId: "follow-up-1",
    leadId: "lead-1",
    to: "5511999999999",
    text: "Ainda posso te ajudar?",
    useVoice: true,
    ttsConfig,
  });
}

function makeStore(outbound: OutboundMessage) {
  return {
    findOutboundMessage: vi.fn().mockResolvedValue(outbound),
    hasEarlierActiveMessage: vi.fn().mockResolvedValue(false),
    markOutboundProcessing: vi.fn().mockResolvedValue(true),
    markOutboundPending: vi.fn().mockResolvedValue(undefined),
    markOutboundDelivered: vi.fn().mockResolvedValue(undefined),
    markOutboundCancelled: vi.fn().mockResolvedValue(undefined),
    countSentSince: vi.fn().mockResolvedValue(0),
  };
}

describe("FollowUpDispatcher outbox", () => {
  it("gera payload e dedupe determinísticos para reexecução do cron", () => {
    const first = makeFollowUpInput();
    const second = makeFollowUpInput();

    expect(first.agentMessageId).toBe(second.agentMessageId);
    expect(first.dedupeKey).toBe("followup:follow-up-1");
    expect(first.outbound).toEqual(second.outbound);
    expect(first.outbound.category).toBe("follow_up");
    expect(first.outbound.payload).toMatchObject({
      version: 1,
      kind: "automation",
      to: "5511999999999",
      text: "Ainda posso te ajudar?",
      leadId: "lead-1",
      conversationId: "conversation-1",
      agentMessageId: first.agentMessageId,
      useVoice: true,
      ttsConfig,
    });
  });

  it("bloqueia follow-up com opt-out pelo safety gate do sender", async () => {
    const { outbound } = makeFollowUpInput();
    const outboundMessage: OutboundMessage = {
      id: "outbound-follow-up-1",
      clinicId: outbound.clinicId,
      conversationId: outbound.conversationId,
      channel: outbound.channel,
      payload: outbound.payload,
      deliveryKind: outbound.deliveryKind,
      category: outbound.category,
      sequence: 1,
      status: "pending",
      providerMessageId: null,
      dedupeKey: outbound.dedupeKey,
      attempts: 0,
      lastError: null,
      createdAt: new Date("2026-07-05T12:00:00.000Z"),
      sentAt: null,
    };
    const store = makeStore(outboundMessage);
    const delivery = vi.fn();
    const automationDispatchLifecycle = {
      markDelivered: vi.fn().mockResolvedValue(undefined),
      markCancelled: vi.fn().mockResolvedValue(undefined),
    };
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader: {
        getContext: vi.fn().mockResolvedValue({
          clinic: {
            id: "clinic-1",
            timezone: "America/Sao_Paulo",
            businessHours: "Seg-Sex 09:00-18:00",
            outboundHourlyCap: 40,
            outboundDailyCap: 200,
          },
          lead: {
            id: "lead-1",
            phone: "5511999999999",
            whatsappLid: null,
            contactConsentRevokedAt: new Date("2026-07-05T12:00:00.000Z"),
          },
          conversation: { id: "conversation-1", leadId: "lead-1" },
          agentMessage: { id: outbound.payload.agentMessageId, conversationId: "conversation-1" },
        }),
      },
      automationDispatchLifecycle,
      delivery,
      now: () => new Date("2026-07-06T13:00:00.000Z"),
      capJitterMs: () => 0,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-follow-up-1" } })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith("outbound-follow-up-1", "consent_revoked");
    expect(automationDispatchLifecycle.markCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "followup:follow-up-1" }),
      "consent_revoked",
      new Date("2026-07-06T13:00:00.000Z"),
    );
    expect(delivery).not.toHaveBeenCalled();
  });
});
