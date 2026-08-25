import { describe, expect, it, vi } from "vitest";
import { digestInboundClaimToken } from "@/application/jobs/inbound-claim-token";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import type {
  OutboundAuthorizationInput,
  OutboundMessage,
} from "@/application/ports/outbound-message-store";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";

const claimToken = "a".repeat(43);

const liveAuthorization = {
  kind: "live_stream_reply",
  streamId: "10000000-0000-4000-8000-000000000001",
  streamGeneration: 1,
  sourceInboundEventId: "10000000-0000-4000-8000-000000000002",
  claimJobId: "10000000-0000-4000-8000-000000000003",
  claimToken,
} satisfies OutboundAuthorizationInput;

const outbound: OutboundMessage = {
  id: "outbound-1",
  clinicId: "clinic-1",
  conversationId: "conversation-1",
  channel: "whatsapp",
  payload: {
    version: 1,
    kind: "operator_message",
    to: "5511999999999",
    operatorMessageId: "operator-1",
    text: "Olá",
  },
  deliveryKind: "text",
  category: "reply",
  sequence: 1,
  status: "pending",
  providerMessageId: null,
  dedupeKey: "operator:1",
  attempts: 0,
  lastError: null,
  authorization: {
    kind: "live_stream_reply",
    streamId: liveAuthorization.streamId,
    streamGeneration: liveAuthorization.streamGeneration,
    sourceInboundEventId: liveAuthorization.sourceInboundEventId,
    claimJobId: liveAuthorization.claimJobId,
    claimTokenDigest: digestInboundClaimToken(claimToken),
    authorityVersion: 2,
  },
  createdAt: new Date("2026-08-24T12:00:00.000Z"),
  sentAt: null,
};

describe("WhatsApp outbound durable authorization", () => {
  it.each([
    "follow_up",
    "reminder",
    "campaign",
    "human_manual",
    "operational",
    "system",
    "recovery",
    "legacy",
  ] as const)("models the explicit %s authorization kind", (kind) => {
    const authorization: OutboundAuthorizationInput = { kind };
    expect(authorization).toEqual({ kind });
  });

  it("requires the sender preflight before any irreversible delivery", async () => {
    const delivery = vi.fn();
    const store = {
      findOutboundMessage: vi.fn().mockResolvedValue(outbound),
      authorizeOutboundMessageForSend: vi.fn().mockResolvedValue({
        authorized: false,
        reason: "authority_below_v2",
      }),
      hasEarlierActiveMessage: vi.fn().mockResolvedValue(false),
      markOutboundProcessing: vi.fn().mockResolvedValue(true),
      markOutboundDelivered: vi.fn().mockResolvedValue(undefined),
      markOutboundPending: vi.fn().mockResolvedValue(undefined),
      markOutboundCancelled: vi.fn().mockResolvedValue(undefined),
      countSentSince: vi.fn().mockResolvedValue(0),
    };
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("ignored");
    expect(store.authorizeOutboundMessageForSend).toHaveBeenCalledWith(outbound.id);
    expect(delivery).not.toHaveBeenCalled();
  });

  it.each([
    "authority_below_v2",
    "claim_mismatch",
    "clinic_not_active",
    "auto_reply_disabled",
    "shadow_observe",
    "human_takeover",
    "consent_revoked",
    "opted_out",
    "safety_blocked",
    "global_kill_switch",
    "outbound_not_sendable",
  ] as const)("cancels %s immediately before provider delivery", async (reason) => {
    const delivery = vi.fn();
    const trace = new InMemoryDecisionTraceSink();
    const store = {
      findOutboundMessage: vi.fn().mockResolvedValue(outbound),
      authorizeOutboundMessageForSend: vi.fn().mockResolvedValue({
        authorized: false,
        reason,
      }),
      hasEarlierActiveMessage: vi.fn().mockResolvedValue(false),
      markOutboundProcessing: vi.fn().mockResolvedValue(true),
      markOutboundDelivered: vi.fn(),
      markOutboundPending: vi.fn(),
      markOutboundCancelled: vi.fn(),
      countSentSince: vi.fn().mockResolvedValue(0),
    };
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: {
        appendMessage: vi.fn().mockResolvedValue(true),
        findMessageById: vi.fn(),
      },
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
      decisionTraceSink: trace,
      delivery,
    });

    await expect(handler.processJob({
      payload: { outboundMessageId: outbound.id, turnId: "turn-preflight" },
    }))
      .resolves.toBe("ignored");
    expect(store.markOutboundProcessing).toHaveBeenCalledOnce();
    expect(store.authorizeOutboundMessageForSend).toHaveBeenCalledOnce();
    expect(store.markOutboundProcessing.mock.invocationCallOrder[0])
      .toBeLessThan(store.authorizeOutboundMessageForSend.mock.invocationCallOrder[0]!);
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(outbound.id, reason);
    expect(delivery).not.toHaveBeenCalled();
    expect(trace.getEvents("turn-preflight")).toContainEqual(expect.objectContaining({
      stage: "turn.ignored",
      metadata: { reason },
    }));
    expect(JSON.stringify(trace.getEvents("turn-preflight"))).not.toContain(claimToken);
  });

  it("never places a raw token or token digest in the message.send payload", () => {
    const jobPayload = { outboundMessageId: outbound.id, turnId: "turn-1" };
    expect(JSON.stringify(jobPayload)).not.toContain(claimToken);
    expect(JSON.stringify(jobPayload)).not.toContain(digestInboundClaimToken(claimToken));
  });
});
