import { describe, expect, it, vi } from "vitest";
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
    markOutboundDelivered: vi.fn().mockResolvedValue(undefined),
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
});
