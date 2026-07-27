import { describe, expect, it, vi } from "vitest";
import { ProcessMessageJobHandler } from "@/application/jobs/process-message-job";
import type { InboundEvent } from "@/application/ports/inbound-event-store";
import type { JobRecord } from "@/application/ports/job-queue";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";

const event: InboundEvent = {
  id: "event-1",
  clinicId: "clinic-1",
  provider: "z_api",
  providerMessageId: "message-1",
  conversationKey: "5511999999999",
  payload: {
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
  },
  normalizedText: "Olá",
  mediaType: null,
  dedupeKey: "z-api:instance-1:message-1",
  processingStatus: "pending",
  receivedAt: new Date("2026-06-23T12:00:00.000Z"),
  processedAt: null,
};

const job: JobRecord = {
  id: "job-1",
  queue: "message.process",
  status: "processing",
  payload: { inboundEventId: "event-1" },
  dedupeKey: "inbound-event:event-1",
  attempts: 1,
  maxAttempts: 10,
  runAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedAt: new Date("2026-06-23T12:00:00.000Z"),
  lockedBy: "worker-1",
  lastError: null,
  createdAt: new Date("2026-06-23T12:00:00.000Z"),
  updatedAt: new Date("2026-06-23T12:00:00.000Z"),
};

function makeHandler(overrides: Partial<ConstructorParameters<typeof ProcessMessageJobHandler>[0]> = {}) {
  const inboundEventStore = {
    findInboundEvent: vi.fn().mockResolvedValue(event),
    markInboundEventProcessing: vi.fn().mockResolvedValue(undefined),
    markInboundEventProcessed: vi.fn().mockResolvedValue(undefined),
    markInboundEventIgnored: vi.fn().mockResolvedValue(undefined),
  };
  const automationPolicy = { getAutomationMode: vi.fn().mockResolvedValue("live") };
  const conversationHandler = { handle: vi.fn().mockResolvedValue({ replied: true }) };
  const resolveInboundContent = vi.fn().mockResolvedValue({ messageText: "Olá", shouldReply: true });
  const decisionTraceSink = new InMemoryDecisionTraceSink();

  return {
    handler: new ProcessMessageJobHandler({
      inboundEventStore: inboundEventStore as never,
      automationPolicy,
      conversationHandler,
      resolveInboundContent,
      transcribeAudio: vi.fn(),
      decisionTraceSink,
      ...overrides,
    }),
    inboundEventStore,
    automationPolicy,
    conversationHandler,
    resolveInboundContent,
    decisionTraceSink,
  };
}

describe("ProcessMessageJobHandler", () => {
  it("processa o evento persistido e só então marca a entrada como concluída", async () => {
    const { handler, inboundEventStore, conversationHandler, decisionTraceSink } = makeHandler();

    const result = await handler.processJob(job);

    expect(result).toEqual({ outcome: "processed", inboundEventId: "event-1" });
    expect(inboundEventStore.markInboundEventProcessing).toHaveBeenCalledWith("event-1");
    expect(conversationHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        phone: "5511999999999",
        messageId: "message-1",
        turnId: "event-1",
        replyEnabled: true,
      }),
    );
    expect(inboundEventStore.markInboundEventProcessed).toHaveBeenCalledWith("event-1");
    expect(decisionTraceSink.getEvents("event-1").map((entry) => entry.stage)).toEqual([
      "ingress.received",
      "ingress.content_resolved",
      "orchestrator.completed",
    ]);
  });

  it.each([
    [
      "objeto JSONB sem flags opcionais da Z-API",
      {
        phone: "5511999999999",
        instanceId: "instance-1",
        messageId: "message-1",
        text: { message: "Olá" },
      },
    ],
    [
      "JSON serializado sem flags opcionais da Z-API",
      JSON.stringify({
        phone: "5511999999999",
        instanceId: "instance-1",
        messageId: "message-1",
        text: { message: "Olá" },
      }),
    ],
  ])("processa payload como %s", async (_description, payload) => {
    const inboundEventStore = {
      findInboundEvent: vi.fn().mockResolvedValue({ ...event, payload }),
      markInboundEventProcessing: vi.fn().mockResolvedValue(undefined),
      markInboundEventProcessed: vi.fn().mockResolvedValue(undefined),
      markInboundEventIgnored: vi.fn().mockResolvedValue(undefined),
    };
    const { handler, conversationHandler } = makeHandler({
      inboundEventStore: inboundEventStore as never,
    });

    await expect(handler.processJob(job)).resolves.toEqual({
      outcome: "processed",
      inboundEventId: "event-1",
    });

    expect(conversationHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "5511999999999",
        messageId: "message-1",
      }),
    );
    expect(inboundEventStore.markInboundEventProcessed).toHaveBeenCalledWith("event-1");
  });

  it("processa evento Meta persistido pelo mesmo worker sem passar pelo normalizador Z-API", async () => {
    const metaEvent: InboundEvent = {
      ...event,
      provider: "meta_cloud_api",
      providerMessageId: "wamid.meta-1",
      dedupeKey: "meta:phone-number-1:wamid.meta-1",
      payload: {
        entry: [{
          changes: [{
            value: {
              metadata: { phone_number_id: "phone-number-1" },
              contacts: [{ profile: { name: "Lead Meta" } }],
              messages: [{
                id: "wamid.meta-1",
                from: "5511888888888",
                timestamp: "1785067200",
                type: "text",
                text: { body: "Olá pelo Meta" },
              }],
            },
          }],
        }],
      },
    };
    const inboundEventStore = {
      findInboundEvent: vi.fn().mockResolvedValue(metaEvent),
      markInboundEventProcessing: vi.fn().mockResolvedValue(undefined),
      markInboundEventProcessed: vi.fn().mockResolvedValue(undefined),
      markInboundEventIgnored: vi.fn().mockResolvedValue(undefined),
    };
    const resolveInboundContent = vi.fn();
    const { handler, conversationHandler } = makeHandler({
      inboundEventStore: inboundEventStore as never,
      resolveInboundContent,
    });

    await expect(handler.processJob(job)).resolves.toEqual({
      outcome: "processed",
      inboundEventId: "event-1",
    });
    expect(resolveInboundContent).not.toHaveBeenCalled();
    expect(conversationHandler.handle).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: "clinic-1",
      phone: "5511888888888",
      messageId: "wamid.meta-1",
      messageText: "Olá pelo Meta",
      senderName: "Lead Meta",
    }));
  });

  it("continua ignorando payload fromMe serializado como string", async () => {
    const inboundEventStore = {
      findInboundEvent: vi.fn().mockResolvedValue({
        ...event,
        payload: {
          phone: "5511999999999",
          instanceId: "instance-1",
          messageId: "message-1",
          fromMe: "true",
        },
      }),
      markInboundEventProcessing: vi.fn().mockResolvedValue(undefined),
      markInboundEventProcessed: vi.fn().mockResolvedValue(undefined),
      markInboundEventIgnored: vi.fn().mockResolvedValue(undefined),
    };
    const { handler, conversationHandler } = makeHandler({
      inboundEventStore: inboundEventStore as never,
    });

    await expect(handler.processJob(job)).resolves.toEqual({
      outcome: "ignored",
      inboundEventId: "event-1",
    });

    expect(inboundEventStore.markInboundEventIgnored).toHaveBeenCalledWith("event-1");
    expect(conversationHandler.handle).not.toHaveBeenCalled();
  });

  it("marca eventos sem conteúdo reconhecível como ignorados sem chamar a jornada", async () => {
    const { handler, inboundEventStore, conversationHandler } = makeHandler({
      resolveInboundContent: vi.fn().mockResolvedValue(null),
    });

    const result = await handler.processJob(job);

    expect(result).toEqual({ outcome: "ignored", inboundEventId: "event-1" });
    expect(inboundEventStore.markInboundEventIgnored).toHaveBeenCalledWith("event-1");
    expect(conversationHandler.handle).not.toHaveBeenCalled();
  });

  it("não reprocessa um evento que já foi concluído", async () => {
    const { handler, inboundEventStore, conversationHandler } = makeHandler({
      inboundEventStore: {
        findInboundEvent: vi.fn().mockResolvedValue({ ...event, processingStatus: "processed" }),
      } as never,
    });

    await expect(handler.processJob(job)).resolves.toEqual({
      outcome: "ignored",
      inboundEventId: "event-1",
    });
    expect(conversationHandler.handle).not.toHaveBeenCalled();
    expect(inboundEventStore.markInboundEventProcessing).not.toHaveBeenCalled();
  });

  it("registra falha do turno sem engolir o erro do orquestrador", async () => {
    const conversationHandler = {
      handle: vi.fn().mockRejectedValue(new TypeError("composer unavailable")),
    };
    const { handler, decisionTraceSink } = makeHandler({ conversationHandler });

    await expect(handler.processJob(job)).rejects.toThrow("composer unavailable");
    expect(decisionTraceSink.getEvents("event-1").at(-1)).toEqual(
      expect.objectContaining({
        stage: "turn.failed",
        metadata: {
          phase: "orchestrator_or_acknowledgement",
          errorName: "TypeError",
        },
      }),
    );
  });

  it("registra silêncio intencional como terminal observável do turno", async () => {
    const conversationHandler = {
      handle: vi.fn().mockResolvedValue({
        replied: false,
        reason: "ai_paused",
      }),
    };
    const { handler, decisionTraceSink } = makeHandler({ conversationHandler });

    await handler.processJob(job);

    expect(decisionTraceSink.getEvents("event-1").slice(-2)).toEqual([
      expect.objectContaining({
        stage: "orchestrator.completed",
        metadata: expect.objectContaining({ replied: false }),
      }),
      expect.objectContaining({
        stage: "turn.ignored",
        metadata: { reason: "ai_paused" },
      }),
    ]);
  });

  it("registra falha técnica tratada como failed, não como silêncio intencional", async () => {
    const conversationHandler = {
      handle: vi.fn().mockResolvedValue({
        replied: false,
        reason: "technical_error_handoff",
      }),
    };
    const { handler, decisionTraceSink, inboundEventStore } = makeHandler({
      conversationHandler,
    });

    await expect(handler.processJob(job)).resolves.toEqual({
      outcome: "processed",
      inboundEventId: "event-1",
    });

    expect(inboundEventStore.markInboundEventProcessed).toHaveBeenCalledWith("event-1");
    expect(decisionTraceSink.getEvents("event-1").at(-1)).toEqual(
      expect.objectContaining({
        stage: "turn.failed",
        metadata: {
          phase: "orchestrator_handled_failure",
          errorName: "HandledTechnicalError",
        },
      }),
    );
    expect(
      decisionTraceSink
        .getEvents("event-1")
        .some((event) => event.stage === "turn.ignored"),
    ).toBe(false);
  });

  it("shadow registra a mensagem em modo observação sem autorizar efeitos da IA", async () => {
    const automationPolicy = { getAutomationMode: vi.fn().mockResolvedValue("observe") };
    const { handler, conversationHandler, resolveInboundContent } = makeHandler({
      automationPolicy,
    });

    await handler.processJob(job);

    expect(resolveInboundContent).toHaveBeenCalledWith(expect.objectContaining({
      replyEnabled: false,
      transcriptionEnabled: true,
    }));
    expect(conversationHandler.handle).toHaveBeenCalledWith(expect.objectContaining({
      replyEnabled: false,
      observationOnly: true,
    }));
  });
});
