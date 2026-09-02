import { describe, expect, it, vi } from "vitest";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { SendMessageJobHandler, SHADOW_DELIVERY_SUPPRESSED } from "@/application/jobs/send-message-job";
import type { OutboundMessage } from "@/application/ports/outbound-message-store";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import { isConversationOutboundPayload } from "@/application/jobs/conversation-outbound-payload";
import { buildProactiveOutboundPayload, proactiveTurnId } from "@/application/automation/proactive-outbound";
import { buildInitialAgentMessage } from "@/core/pipeline/outbound-message-persistence";
import { V2TerminalHandoffRequiredError } from "@/application/conversation-v2/v2-terminal-failure-policy";

const outbound: OutboundMessage = {
  id: "outbound-1",
  clinicId: "clinic-1",
  conversationId: "conversation-1",
  channel: "whatsapp",
  payload: {
    version: 1,
    kind: "conversation_reply",
    to: "5511999999999",
    agentMessageId: "agent-message-1",
    replyText: "Olá",
    intent: null,
    useVoice: false,
    ttsConfig: { provider: "nova", speed: 0.92 },
    interleavedParts: [],
    mediaParts: [],
    leadId: "lead-1",
    pipelineAdvance: null,
  },
  deliveryKind: "text",
  category: "reply",
  sequence: 2,
  status: "pending",
  providerMessageId: null,
  dedupeKey: "agent-message:agent-message-1",
  attempts: 0,
  lastError: null,
  authorization: {
    kind: "legacy", streamId: null, streamGeneration: null,
    sourceInboundEventId: null, claimJobId: null, claimTokenDigest: null,
    authorityVersion: 0,
  },
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  sentAt: null,
};

function makeStore() {
  return {
    findOutboundMessage: vi.fn().mockResolvedValue(outbound),
    authorizeOutboundMessageForSend: vi.fn().mockResolvedValue({ authorized: true }),
    hasEarlierActiveMessage: vi.fn().mockResolvedValue(false),
    markOutboundProcessing: vi.fn().mockResolvedValue(true),
    markOutboundPending: vi.fn().mockResolvedValue(undefined),
    markOutboundDelivered: vi.fn().mockResolvedValue(undefined),
    markOutboundCancelled: vi.fn().mockResolvedValue(undefined),
    countSentSince: vi.fn().mockResolvedValue(0),
  };
}

function legacyConversationRepository() {
  return {
    appendMessage: vi.fn(),
    findMessageById: vi.fn().mockResolvedValue({
      id: "agent-message-1",
      conversationId: "conversation-1",
      author: "agent",
      body: "Olá",
      mediaUrl: null,
      mediaType: null,
      sentAt: new Date("2026-06-23T11:59:00.000Z"),
      externalId: null,
      intent: null,
      deliveryFormat: null,
    }),
  };
}

function automationOutbound(patch: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    ...outbound,
    id: "outbound-automation-1",
    category: "follow_up",
    sequence: 1,
    dedupeKey: "followup:follow-up-1",
    payload: {
      version: 1,
      kind: "automation",
      to: "5511999999999",
      text: "Ainda posso te ajudar?",
      leadId: "lead-1",
      conversationId: "conversation-1",
      agentMessageId: "agent-message-automation-1",
      useVoice: false,
    },
    ...patch,
  };
}

function senderOwnedAutomationOutbound(patch: Partial<OutboundMessage> = {}): OutboundMessage {
  return automationOutbound({
    authorization: {
      kind: "follow_up",
      streamId: null,
      streamGeneration: null,
      sourceInboundEventId: null,
      claimJobId: null,
      claimTokenDigest: null,
      authorityVersion: 2,
    },
    payload: buildProactiveOutboundPayload({
      authorizationKind: "follow_up",
      turnId: proactiveTurnId("followup:follow-up-1"),
      to: "5511999999999",
      text: "Ainda posso te ajudar?",
      leadId: "lead-1",
      conversationId: "conversation-1",
      agentMessageId: "agent-message-automation-1",
      useVoice: false,
    }),
    ...patch,
  });
}

function makeSafetyContextReader(patch: {
  contactConsentRevokedAt?: Date | null;
  outboundHourlyCap?: number;
  outboundDailyCap?: number;
  businessHours?: string | null;
  agentMessage?: { id: string; conversationId: string } | null;
} = {}) {
  return {
    getContext: vi.fn().mockResolvedValue({
      clinic: {
        id: "clinic-1",
        timezone: "America/Sao_Paulo",
        businessHours: patch.businessHours ?? "Seg-Sex 09:00-18:00",
        outboundHourlyCap: patch.outboundHourlyCap ?? 40,
        outboundDailyCap: patch.outboundDailyCap ?? 200,
      },
      lead: {
        id: "lead-1",
        phone: "5511999999999",
        whatsappLid: null,
        contactConsentRevokedAt: patch.contactConsentRevokedAt ?? null,
      },
      conversation: {
        id: "conversation-1",
        leadId: "lead-1",
      },
      agentMessage: patch.agentMessage === undefined ? {
        id: "agent-message-automation-1",
        conversationId: "conversation-1",
      } : patch.agentMessage,
    }),
  };
}

function makeAutomationDispatchLifecycle() {
  return {
    markDelivered: vi.fn().mockResolvedValue(undefined),
    markCancelled: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SendMessageJobHandler", () => {
  it("persists proactive canonical history only after final authorization", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(senderOwnedAutomationOutbound());
    const conversationRepository = {
      appendMessage: vi.fn().mockResolvedValue(true),
      findMessageById: vi.fn().mockResolvedValue(null),
    };
    const delivery = vi.fn().mockResolvedValue("provider-1");
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository,
      safetyContextReader: makeSafetyContextReader({ agentMessage: null }),
      automationDispatchLifecycle: makeAutomationDispatchLifecycle(),
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
      capJitterMs: () => 0,
      now: () => new Date("2026-07-06T15:00:00.000Z"),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } }))
      .resolves.toBe("sent");
    expect(store.authorizeOutboundMessageForSend).toHaveBeenCalledOnce();
    expect(conversationRepository.appendMessage).toHaveBeenCalledOnce();
    expect(delivery).toHaveBeenCalledOnce();
  });

  it("leaves no proactive history when final authorization denies delivery", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(senderOwnedAutomationOutbound());
    store.authorizeOutboundMessageForSend.mockResolvedValue({
      authorized: false,
      reason: "global_kill_switch",
    });
    const conversationRepository = {
      appendMessage: vi.fn(),
      findMessageById: vi.fn().mockResolvedValue(null),
    };
    const delivery = vi.fn();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository,
      safetyContextReader: makeSafetyContextReader({ agentMessage: null }),
      automationDispatchLifecycle: makeAutomationDispatchLifecycle(),
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
      capJitterMs: () => 0,
      now: () => new Date("2026-07-06T15:00:00.000Z"),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } }))
      .resolves.toBe("ignored");
    expect(store.authorizeOutboundMessageForSend).toHaveBeenCalledOnce();
    expect(conversationRepository.appendMessage).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
  });

  it("accepts sender-owned persistence without a build approval binding", () => {
    expect(isConversationOutboundPayload({
      ...(outbound.payload as Record<string, unknown>),
      agentMessagePersistence: "sender",
    })).toBe(true);
  });

  it.each([
    { ...(outbound.payload as Record<string, unknown>), internalLabBinding: {} },
    { ...(outbound.payload as Record<string, unknown>), unexpected: true },
  ])("rejects obsolete or unknown conversation payload fields", (payload) => {
    expect(isConversationOutboundPayload(payload)).toBe(false);
  });

  it("fails closed when a legacy reply has no exact pre-existing agent message", async () => {
    const store = makeStore();
    const delivery = vi.fn();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: {
        appendMessage: vi.fn(),
        findMessageById: vi.fn().mockResolvedValue(null),
      },
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      outbound.id,
      "conversation_agent_message_missing",
    );
    expect(delivery).not.toHaveBeenCalled();
  });

  it("does not let an existing sender-created V2 placeholder downgrade to legacy on retry", async () => {
    const store = makeStore();
    const delivery = vi.fn();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: {
        appendMessage: vi.fn(),
        findMessageById: vi.fn().mockResolvedValue({
          id: "agent-message-1",
          conversationId: "conversation-1",
          author: "agent",
          body: "Olá",
          mediaUrl: null,
          mediaType: null,
          sentAt: new Date("2026-08-17T12:00:00.000Z"),
          externalId: null,
          intent: null,
          deliveryFormat: null,
        }),
      },
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("ignored");
    expect(delivery).not.toHaveBeenCalled();
  });

  it("delivers the exact canonical V1 deposit message persisted as text", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue({
      ...outbound,
      payload: {
        ...(outbound.payload as Record<string, unknown>),
        intent: "confirm_slot",
        replyText: "Para reservar, envie o sinal via Pix.",
      },
    });
    const delivery = vi.fn().mockResolvedValue("provider-deposit");
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: {
        appendMessage: vi.fn(),
        findMessageById: vi.fn().mockResolvedValue({
          id: "agent-message-1",
          conversationId: "conversation-1",
          author: "agent",
          body: "Para reservar, envie o sinal via Pix.",
          mediaUrl: null,
          mediaType: null,
          sentAt: new Date("2026-06-23T11:59:00.000Z"),
          externalId: null,
          intent: "confirm_slot",
          deliveryFormat: "text",
        }),
      },
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("sent");
    expect(delivery).toHaveBeenCalledOnce();
    expect(store.markOutboundCancelled).not.toHaveBeenCalled();
  });

  it("delivers the exact first-media representation persisted by canonical V1 composition", async () => {
    const firstMedia = {
      type: "media" as const,
      mediaId: "media-1",
      url: "https://cdn.example.test/before-after.jpg",
      mediaType: "image" as const,
      title: "Antes e depois",
    };
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue({
      ...outbound,
      payload: {
        ...(outbound.payload as Record<string, unknown>),
        replyText: "Veja este resultado.",
        intent: "general_question",
        interleavedParts: [firstMedia, { type: "text", content: "Gostou?" }],
      },
    });
    const persisted = buildInitialAgentMessage({
      id: "agent-message-1",
      conversationId: "conversation-1",
      replyText: "Veja este resultado.",
      sentAt: new Date("2026-06-23T11:59:00.000Z"),
      intent: "general_question",
      hasInterleavedMedia: true,
      outboundParts: [firstMedia, { type: "text", content: "Gostou?" }],
    });
    const delivery = vi.fn().mockResolvedValue("provider-media");
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: {
        appendMessage: vi.fn(),
        findMessageById: vi.fn().mockResolvedValue(persisted),
      },
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("sent");
    expect(delivery).toHaveBeenCalledOnce();
    expect(store.markOutboundCancelled).not.toHaveBeenCalled();
  });

  it("delivers sender-owned V2 after durable preflight without an Internal Lab binding", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue({
      ...outbound,
      authorization: {
        kind: "live_stream_reply",
        streamId: "stream-v2",
        streamGeneration: 2,
        sourceInboundEventId: "event-v2",
        claimJobId: "job-v2",
        claimTokenDigest: "a".repeat(43),
        authorityVersion: 2,
      },
      payload: {
        ...(outbound.payload as Record<string, unknown>),
        turnId: "turn-v2",
      },
    });
    const delivery = vi.fn().mockResolvedValue("provider-v2");
    const appendMessage = vi.fn().mockResolvedValue(true);
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: { appendMessage, findMessageById: vi.fn() },
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
    });

    await expect(handler.processJob({
      payload: { outboundMessageId: outbound.id, turnId: "turn-v2" },
    })).resolves.toBe("sent");
    expect(appendMessage).toHaveBeenCalledOnce();
    expect(delivery).toHaveBeenCalledOnce();
    expect(store.markOutboundCancelled).not.toHaveBeenCalled();
  });

  it("fences every persisted live_stream_reply when definitive preflight denies it", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue({
      ...outbound,
      authorization: {
        kind: "live_stream_reply",
        streamId: "stream-1",
        streamGeneration: 4,
        sourceInboundEventId: "event-4",
        claimJobId: "job-4",
        claimTokenDigest: `sha256:${"a".repeat(64)}`,
        authorityVersion: 2,
      },
    });
    store.authorizeOutboundMessageForSend.mockResolvedValue({
      authorized: false,
      reason: "global_kill_switch",
    });
    const delivery = vi.fn().mockResolvedValue("must-not-send");
    const appendMessage = vi.fn().mockResolvedValue(true);
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: {
        appendMessage,
        findMessageById: vi.fn(),
      },
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
    });

    await expect(handler.processJob({ payload: { outboundMessageId: outbound.id } }))
      .resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      outbound.id,
      "global_kill_switch",
    );
    expect(appendMessage).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
  });

  it("lets only one concurrent sender claim reach provider for a live reply", async () => {
    const store = makeStore();
    const liveOutbound: OutboundMessage = {
      ...outbound,
      authorization: {
        kind: "live_stream_reply",
        streamId: "stream-1",
        streamGeneration: 4,
        sourceInboundEventId: "event-4",
        claimJobId: "job-4",
        claimTokenDigest: "a".repeat(43),
        authorityVersion: 2,
      },
    };
    store.findOutboundMessage.mockResolvedValue(liveOutbound);
    store.markOutboundProcessing
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const delivery = vi.fn().mockResolvedValue("provider-live-1");
    const appendMessage = vi.fn().mockResolvedValue(true);
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      conversationRepository: { appendMessage, findMessageById: vi.fn() },
      delivery,
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
    });

    const results = await Promise.all([
      handler.processJob({ id: "send-job-a", payload: { outboundMessageId: outbound.id } }),
      handler.processJob({ id: "send-job-b", payload: { outboundMessageId: outbound.id } }),
    ]);

    expect(results.sort()).toEqual(["ignored", "sent"]);
    expect(store.authorizeOutboundMessageForSend).toHaveBeenCalledOnce();
    expect(appendMessage).toHaveBeenCalledOnce();
    expect(delivery).toHaveBeenCalledOnce();
    expect(store.markOutboundDelivered).toHaveBeenCalledOnce();
  });

  it("devolve a mensagem para espera quando existe uma saída anterior ativa", async () => {
    const store = makeStore();
    store.hasEarlierActiveMessage.mockResolvedValue(true);
    const delivery = vi.fn();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-1" } })).resolves.toBe("deferred");
    expect(store.markOutboundProcessing).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
  });

  it("envia somente após obter o claim da outbox e marca a entrega", async () => {
    const store = makeStore();
    const delivery = vi.fn().mockResolvedValue("zapi-message-1");
    const decisionTraceSink = new InMemoryDecisionTraceSink();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery,
      conversationRepository: legacyConversationRepository(),
      decisionTraceSink,
      conversationStateReader: {
        getCurrentState: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(
      handler.processJob({
        payload: { outboundMessageId: "outbound-1", turnId: "turn-1" },
      }),
    ).resolves.toBe("sent");
    expect(delivery).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: "clinic-1", conversationId: "conversation-1" }),
    );
    expect(store.markOutboundDelivered).toHaveBeenCalledWith({
      id: "outbound-1",
      providerMessageId: "zapi-message-1",
    });
    expect(decisionTraceSink.getEvents("turn-1").map((entry) => entry.stage)).toEqual([
      "delivery.started",
      "state.after_delivery",
      "delivery.sent",
    ]);
  });

  it("registra a fase da falha quando o provider rejeita a entrega", async () => {
    const store = makeStore();
    const decisionTraceSink = new InMemoryDecisionTraceSink();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      conversationRepository: legacyConversationRepository(),
      decisionTraceSink,
    });

    await expect(handler.processJob({
      payload: { outboundMessageId: "outbound-1", turnId: "turn-1" },
    })).rejects.toMatchObject({
      name: "V2TerminalHandoffRequiredError",
      message: "v2_terminal_handoff_required:delivery_outcome_indeterminate",
    });
    expect(decisionTraceSink.getEvents("turn-1").map((entry) => entry.stage))
      .toEqual(["delivery.started", "turn.failed"]);
    expect(decisionTraceSink.getEvents("turn-1").at(-1)?.metadata).toEqual({
      phase: "delivery",
      errorName: "Error",
    });
  });

  it("keeps a proven pre-provider pipeline failure retryable", async () => {
    const store = makeStore();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery: vi.fn().mockRejectedValue(new Error("configuration unavailable")),
      deliveryFailureBoundary: "tracked_pipeline",
      conversationRepository: legacyConversationRepository(),
    });

    await expect(handler.processJob({
      payload: { outboundMessageId: "outbound-1" },
    })).rejects.toThrow("configuration unavailable");
  });

  it("closes delivery when the provider accepts but sent persistence fails", async () => {
    const store = makeStore();
    store.markOutboundDelivered.mockRejectedValue(new Error("database unavailable"));
    const delivery = vi.fn().mockResolvedValue("provider-accepted-1");
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery,
      conversationRepository: legacyConversationRepository(),
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
    });

    await expect(handler.processJob({
      id: "send-job-1",
      payload: { outboundMessageId: "outbound-1" },
    })).rejects.toEqual(new V2TerminalHandoffRequiredError("delivery_outcome_indeterminate"));
    expect(delivery).toHaveBeenCalledOnce();
    expect(store.markOutboundDelivered).toHaveBeenCalledOnce();
  });

  it("never resends after sent persistence succeeds and lifecycle reconciliation fails", async () => {
    const store = makeStore();
    const delivery = vi.fn().mockResolvedValue("provider-accepted-1");
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    automationDispatchLifecycle.markDelivered.mockRejectedValue(
      new Error("lifecycle unavailable"),
    );
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery,
      conversationRepository: legacyConversationRepository(),
      conversationStateReader: { getCurrentState: vi.fn().mockResolvedValue(null) },
      automationDispatchLifecycle,
    });

    await expect(handler.processJob({
      id: "send-job-1",
      payload: { outboundMessageId: "outbound-1" },
    })).rejects.toThrow("lifecycle unavailable");
    store.findOutboundMessage.mockResolvedValue({ ...outbound, status: "sent" });
    await expect(handler.processJob({
      id: "send-job-1",
      payload: { outboundMessageId: "outbound-1" },
    })).rejects.toThrow("lifecycle unavailable");
    expect(delivery).toHaveBeenCalledOnce();
  });

  it("não reenfileira uma saída já entregue", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue({ ...outbound, status: "sent" });
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery: vi.fn(),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-1" } })).resolves.toBe("ignored");
    expect(store.hasEarlierActiveMessage).not.toHaveBeenCalled();
  });

  it("cancela outbox shadow sem marcar entrega nem executar lifecycle", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(automationOutbound({ category: "reply" }));
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery: vi.fn().mockResolvedValue(SHADOW_DELIVERY_SUPPRESSED),
      automationDispatchLifecycle,
      safetyContextReader: makeSafetyContextReader(),
    });

    await expect(handler.processJob({
      payload: { outboundMessageId: "outbound-automation-1" },
    })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      "outbound-automation-1",
      "shadow_mode",
    );
    expect(store.markOutboundDelivered).not.toHaveBeenCalled();
    expect(automationDispatchLifecycle.markDelivered).not.toHaveBeenCalled();
  });

  it("reconcilia lifecycle de automação quando a outbox já está sent", async () => {
    const sentAt = new Date("2026-07-06T13:05:00.000Z");
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(
      automationOutbound({ status: "sent", sentAt }),
    );
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      automationDispatchLifecycle,
      delivery: vi.fn(),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.hasEarlierActiveMessage).not.toHaveBeenCalled();
    expect(automationDispatchLifecycle.markDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "followup:follow-up-1" }),
      sentAt,
    );
  });

  it("reconcilia lifecycle de automação quando a outbox está dead", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(
      automationOutbound({ status: "dead", lastError: "credentials_revoked" }),
    );
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      automationDispatchLifecycle,
      delivery: vi.fn(),
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.hasEarlierActiveMessage).not.toHaveBeenCalled();
    expect(automationDispatchLifecycle.markCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "followup:follow-up-1" }),
      "credentials_revoked",
      expect.any(Date),
    );
  });

  it("cancela automação quando o lead revogou consentimento antes de contar caps", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(automationOutbound());
    const safetyContextReader = makeSafetyContextReader({
      contactConsentRevokedAt: new Date("2026-07-05T12:00:00.000Z"),
    });
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader,
      automationDispatchLifecycle,
      delivery: vi.fn(),
      now: () => new Date("2026-07-06T13:00:00.000Z"),
      capJitterMs: () => 0,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith("outbound-automation-1", "consent_revoked");
    expect(automationDispatchLifecycle.markCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "followup:follow-up-1" }),
      "consent_revoked",
      new Date("2026-07-06T13:00:00.000Z"),
    );
    expect(store.countSentSince).not.toHaveBeenCalled();
  });

  it("cancela automação quando o lead não pertence ao contexto da clínica", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(automationOutbound());
    const safetyContextReader = makeSafetyContextReader();
    safetyContextReader.getContext.mockResolvedValueOnce({
      clinic: {
        id: "clinic-1",
        timezone: "America/Sao_Paulo",
        businessHours: "Seg-Sex 09:00-18:00",
        outboundHourlyCap: 40,
        outboundDailyCap: 200,
      },
      lead: null,
      conversation: null,
      agentMessage: null,
    });
    const delivery = vi.fn();
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader,
      automationDispatchLifecycle,
      delivery,
      now: () => new Date("2026-07-06T13:00:00.000Z"),
      capJitterMs: () => 0,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      "outbound-automation-1",
      "invalid_automation_context",
    );
    expect(automationDispatchLifecycle.markCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "followup:follow-up-1" }),
      "invalid_automation_context",
      new Date("2026-07-06T13:00:00.000Z"),
    );
    expect(store.countSentSince).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
  });

  it("cancela automação quando o destino não pertence ao lead validado", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(
      automationOutbound({
        payload: {
          version: 1,
          kind: "automation",
          to: "5511888888888",
          text: "Ainda posso te ajudar?",
          leadId: "lead-1",
          conversationId: "conversation-1",
          agentMessageId: "agent-message-automation-1",
          useVoice: false,
        },
      }),
    );
    const delivery = vi.fn();
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader: makeSafetyContextReader(),
      automationDispatchLifecycle,
      delivery,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      "outbound-automation-1",
      "invalid_automation_context",
    );
    expect(automationDispatchLifecycle.markCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "followup:follow-up-1" }),
      "invalid_automation_context",
      expect.any(Date),
    );
    expect(store.countSentSince).not.toHaveBeenCalled();
    expect(delivery).not.toHaveBeenCalled();
  });

  it("cancela automação quando payload e outbox apontam para conversas diferentes", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(
      automationOutbound({
        payload: {
          version: 1,
          kind: "automation",
          to: "5511999999999",
          text: "Ainda posso te ajudar?",
          leadId: "lead-1",
          conversationId: "conversation-other",
          agentMessageId: "agent-message-automation-1",
          useVoice: false,
        },
      }),
    );
    const safetyContextReader = makeSafetyContextReader();
    const delivery = vi.fn();
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader,
      automationDispatchLifecycle,
      delivery,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(safetyContextReader.getContext).not.toHaveBeenCalled();
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      "outbound-automation-1",
      "invalid_automation_context",
    );
    expect(automationDispatchLifecycle.markCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "followup:follow-up-1" }),
      "invalid_automation_context",
      expect.any(Date),
    );
    expect(delivery).not.toHaveBeenCalled();
  });

  it("adia automação por cap sem entregar e devolve a outbox para pending", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(automationOutbound());
    store.countSentSince.mockResolvedValueOnce(40).mockResolvedValueOnce(100);
    const delivery = vi.fn();
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader: makeSafetyContextReader(),
      delivery,
      now: () => new Date("2026-07-06T13:00:00.000Z"),
      capJitterMs: () => 0,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toEqual({
      status: "deferred",
      reason: "outbound_hourly_cap_exceeded",
      runAt: new Date("2026-07-06T13:30:00.000Z"),
    });
    expect(store.markOutboundPending).toHaveBeenCalledWith(
      "outbound-automation-1",
      "outbound_hourly_cap_exceeded",
    );
    expect(delivery).not.toHaveBeenCalled();
  });

  it("cancela follow-up obsoleto antes de entregar", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(automationOutbound());
    const automationDispatchLifecycle = makeAutomationDispatchLifecycle();
    const delivery = vi.fn();
    const safetyContextReader = makeSafetyContextReader();
    safetyContextReader.getContext.mockResolvedValue({
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
        contactConsentRevokedAt: null,
        status: "appointment_scheduled",
      },
      conversation: { id: "conversation-1", leadId: "lead-1", aiPaused: false },
      agentMessage: { id: "agent-message-automation-1", conversationId: "conversation-1" },
      lastMessage: { author: "agent", sentAt: new Date("2026-07-06T12:00:00.000Z") },
    });
    const obsoleteHandler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      automationDispatchLifecycle,
      safetyContextReader,
      delivery,
      now: () => new Date("2026-07-06T13:00:00.000Z"),
      capJitterMs: () => 0,
    });

    await expect(obsoleteHandler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith("outbound-automation-1", "automation_obsolete");
    expect(automationDispatchLifecycle.markCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: "followup:follow-up-1" }),
      "automation_obsolete",
      new Date("2026-07-06T13:00:00.000Z"),
    );
    expect(delivery).not.toHaveBeenCalled();
  });

  it("mantém a proteção de sequência quando um defer do gate deixa mensagem anterior pendente", async () => {
    const jobQueue = {
      recoverStaleJobs: vi.fn().mockResolvedValue(0),
      claimNextJob: vi
        .fn()
        .mockResolvedValueOnce({
          id: "job-1",
          payload: { outboundMessageId: "outbound-automation-1" },
          attempts: 1,
          maxAttempts: 10,
          runAt: new Date("2026-07-06T13:00:00.000Z"),
        })
        .mockResolvedValueOnce({
          id: "job-2",
          payload: { outboundMessageId: "outbound-2" },
          attempts: 1,
          maxAttempts: 10,
          runAt: new Date("2026-07-06T13:00:00.000Z"),
        })
        .mockResolvedValue(null),
      releaseJob: vi.fn().mockResolvedValue(true),
      completeJob: vi.fn().mockResolvedValue(true),
      failJob: vi.fn(),
    };
    const store = makeStore();
    store.findOutboundMessage
      .mockResolvedValueOnce(automationOutbound())
      .mockResolvedValueOnce({ ...outbound, id: "outbound-2", sequence: 2 });
    store.hasEarlierActiveMessage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    store.countSentSince.mockResolvedValueOnce(40).mockResolvedValueOnce(100);
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader: makeSafetyContextReader(),
      delivery: vi.fn(),
      now: () => new Date("2026-07-06T13:00:00.000Z"),
      capJitterMs: () => 0,
    });

    const result = await drainMessageSendQueue({
      jobQueue: jobQueue as never,
      outboundMessageStore: store as never,
      terminalHandoffStore: { markForOutboundMessage: vi.fn().mockResolvedValue(true) },
      handler,
      workerId: "worker-1",
      maxJobs: 2,
      now: new Date("2026-07-06T13:00:00.000Z"),
    });

    expect(result.deferred).toBe(2);
    expect(jobQueue.releaseJob).toHaveBeenNthCalledWith(
      1,
      "job-1",
      "worker-1",
      new Date("2026-07-06T13:30:00.000Z"),
    );
    expect(jobQueue.releaseJob).toHaveBeenNthCalledWith(
      2,
      "job-2",
      "worker-1",
      expect.any(Date),
    );
    expect(store.markOutboundProcessing).toHaveBeenCalledTimes(1);
  });
});
