import { describe, expect, it, vi } from "vitest";
import { drainMessageSendQueue } from "@/application/jobs/drain-message-send-queue";
import { SendMessageJobHandler } from "@/application/jobs/send-message-job";
import type { OutboundMessage } from "@/application/ports/outbound-message-store";

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
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  sentAt: null,
};

function makeStore() {
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

function makeSafetyContextReader(patch: {
  contactConsentRevokedAt?: Date | null;
  outboundHourlyCap?: number;
  outboundDailyCap?: number;
  businessHours?: string | null;
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
      agentMessage: {
        id: "agent-message-automation-1",
        conversationId: "conversation-1",
      },
    }),
  };
}

describe("SendMessageJobHandler", () => {
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
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      delivery,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-1" } })).resolves.toBe("sent");
    expect(delivery).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: "clinic-1", conversationId: "conversation-1" }),
    );
    expect(store.markOutboundDelivered).toHaveBeenCalledWith({
      id: "outbound-1",
      providerMessageId: "zapi-message-1",
    });
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

  it("cancela automação quando o lead revogou consentimento antes de contar caps", async () => {
    const store = makeStore();
    store.findOutboundMessage.mockResolvedValue(automationOutbound());
    const safetyContextReader = makeSafetyContextReader({
      contactConsentRevokedAt: new Date("2026-07-05T12:00:00.000Z"),
    });
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader,
      delivery: vi.fn(),
      now: () => new Date("2026-07-06T13:00:00.000Z"),
      capJitterMs: () => 0,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith("outbound-automation-1", "consent_revoked");
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
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader,
      delivery,
      now: () => new Date("2026-07-06T13:00:00.000Z"),
      capJitterMs: () => 0,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      "outbound-automation-1",
      "invalid_automation_context",
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
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader: makeSafetyContextReader(),
      delivery,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      "outbound-automation-1",
      "invalid_automation_context",
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
    const handler = new SendMessageJobHandler({
      outboundMessageStore: store as never,
      safetyContextReader,
      delivery,
    });

    await expect(handler.processJob({ payload: { outboundMessageId: "outbound-automation-1" } })).resolves.toBe("ignored");
    expect(safetyContextReader.getContext).not.toHaveBeenCalled();
    expect(store.markOutboundCancelled).toHaveBeenCalledWith(
      "outbound-automation-1",
      "invalid_automation_context",
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
