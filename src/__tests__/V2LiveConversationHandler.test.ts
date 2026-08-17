import { describe, expect, it, vi } from "vitest";
import type { LiveTurnContext, LiveTurnSnapshot } from "@/application/conversation/live-turn-lifecycle";
import { V2LiveConversationHandler } from "@/application/conversation-v2/v2-live-conversation-handler";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import type { Organization } from "@/domain/entities/clinic";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { Treatment } from "@/domain/entities/treatment";

const now = new Date("2026-08-17T12:00:00.000Z");
const turnId = "turn-v2-live-1";

const clinic = {
  id: "clinic-1",
  name: "SystemOps Dental Lab",
  timezone: "America/Sao_Paulo",
  businessHours: "Seg-Sex 08:00-18:00",
  postAppointmentBufferMinutes: 0,
  slotLookaheadDays: 14,
  maxSlotsToOffer: 3,
  slotOfferTtlMinutes: 15,
  aiContextWindowMessages: 8,
} as Organization;

const lead = {
  id: "lead-1",
  clinicId: clinic.id,
  phone: "5511999999999",
  whatsappLid: null,
  treatmentInterest: "Clareamento",
} as Lead;

const conversation = {
  id: "conversation-1",
  clinicId: clinic.id,
  leadId: lead.id,
  channel: "whatsapp",
  category: "sales",
  aiPaused: false,
} as Conversation;

const inbound: Message = {
  id: "inbound-db-1",
  conversationId: conversation.id,
  author: "lead",
  body: "Quanto custa o clareamento?",
  sentAt: now,
  externalId: "provider-message-1",
};

const treatment = {
  id: "treatment-1",
  clinicId: clinic.id,
  name: "Clareamento",
  aliases: ["clareamento dental"],
  durationMinutes: 60,
  priceCents: 80_000,
  minPriceCents: null,
  maxPriceCents: null,
  priceQuotableInChat: true,
  priceKind: "fixed",
  priceUnit: null,
  priceDeductible: false,
  description: null,
  requiresEvaluationFirst: false,
  keywordMatchEnabled: true,
  isAesthetic: true,
  pipelineSteps: null,
  createdAt: now,
  updatedAt: now,
} as Treatment;

function handleInput(messageText = inbound.body) {
  return {
    clinicId: clinic.id,
    phone: lead.phone!,
    messageText,
    messageId: inbound.externalId!,
    timestamp: now,
    turnId,
    automationMode: "live" as const,
  };
}

function makeHarness(options: {
  beginOutcome?: "ready" | "duplicate" | "busy";
  understandingFailure?: boolean;
  decisionFailure?: boolean;
  bookingTurn?: boolean;
  schedulingOfferTurn?: boolean;
  cleanupFailure?: boolean;
  outboxFailure?: boolean;
  clockFailure?: boolean;
  modelId?: "gpt-4o-mini";
  nonPreparedStatus?: "suppressed" | "needs_clarification" | "escalated";
} = {}) {
  const releaseLease = vi.fn().mockResolvedValue(undefined);
  const context: LiveTurnContext = Object.freeze({
    turnId,
    clinicId: clinic.id,
    leadId: lead.id,
    conversationId: conversation.id,
    inboundMessageId: inbound.id,
    clinic,
    lead,
    conversation,
    inboundMessage: inbound,
    outboundAddress: lead.phone!,
    editorial: null,
    releaseLease,
  });
  const offeredState = {
    id: "state-slots-1",
    conversationId: conversation.id,
    state: "slots_offered" as const,
    payload: {
      treatmentId: treatment.id,
      treatmentName: treatment.name,
      durationMinutes: treatment.durationMinutes,
      expiresAt: "2026-08-17T13:00:00.000Z",
      slots: [{
        index: 1,
        startsAt: "2026-08-18T18:00:00.000Z",
        endsAt: "2026-08-18T19:00:00.000Z",
        label: "amanhã às 15h",
      }],
    },
    supersedesStateId: null,
    createdAt: now,
    expiresAt: new Date("2026-08-17T13:00:00.000Z"),
  };
  const snapshot: LiveTurnSnapshot = Object.freeze({
    history: Object.freeze([inbound]),
    currentState: options.bookingTurn ? offeredState : null,
    lastResetBoundary: null,
  });
  const begin = vi.fn().mockResolvedValue(
    options.beginOutcome === "duplicate"
      ? { outcome: "duplicate", reason: "external_id" }
      : options.beginOutcome === "busy"
        ? { outcome: "busy", reason: "conversation_lease" }
        : { outcome: "ready", context },
  );
  const lifecycle = {
    begin,
    loadSnapshot: vi.fn().mockResolvedValue(snapshot),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  const understand = vi.fn().mockImplementation(async () => {
    if (options.understandingFailure) throw new Error("model payload with private text");
    if (options.nonPreparedStatus === "needs_clarification") {
      return {
        version: UNDERSTANDING_VERSION,
        request: "price-of-service" as const,
        dialogueMove: "new_topic" as const,
        entities: {},
        signals: {}, safety: {}, confidence: 1, ambiguity: null,
      } as never;
    }
    const safety = options.nonPreparedStatus === "escalated"
      ? { requestsHuman: true }
      : {};
    if (options.schedulingOfferTurn) {
      return {
        version: UNDERSTANDING_VERSION,
        request: "book-appointment" as const,
        dialogueMove: "new_topic" as const,
        entities: { service: "clareamento", date: "amanhã", period: "afternoon" },
        signals: {}, safety, confidence: 1, ambiguity: null,
      };
    }
    return options.bookingTurn
      ? {
          version: UNDERSTANDING_VERSION,
          request: "confirm-slot" as const,
          dialogueMove: "answers_pending" as const,
          entities: { ordinal: 1 },
          signals: {}, safety, confidence: 1, ambiguity: null,
        }
      : {
          version: UNDERSTANDING_VERSION,
          request: "price-of-service" as const,
          dialogueMove: "new_topic" as const,
          entities: { service: "clareamento" },
          signals: {}, safety, confidence: 1, ambiguity: null,
        };
  });
  const appointment = {
    id: "appointment-1",
    clinicId: clinic.id,
    leadId: lead.id,
    startsAt: new Date("2026-08-18T18:00:00.000Z"),
    endsAt: new Date("2026-08-18T19:00:00.000Z"),
    status: "scheduled",
  };
  const booking = {
    book: vi.fn().mockResolvedValue({ success: true, appointment }),
    confirmAppointment: vi.fn(),
  };
  const currentState = vi.fn().mockResolvedValue(offeredState);
  const createOutboundMessageAndEnqueue = options.outboxFailure
    ? vi.fn().mockRejectedValue(new Error("outbox unavailable"))
    : vi.fn().mockResolvedValue({
        outboundMessageId: "outbound-1",
        messageWasNew: true,
        jobWasNew: true,
      });
  const trace = new InMemoryDecisionTraceSink();
  const handler = new V2LiveConversationHandler({
    lifecycle,
    understanding: { modelId: options.modelId ?? "gpt-4o-mini", understand },
    dental: {
      treatments: {
        listByClinic: options.decisionFailure
          ? vi.fn().mockRejectedValue(new Error("catalog unavailable"))
          : vi.fn().mockResolvedValue([treatment]),
      },
      calendar: {
        listAvailableSlots: vi.fn().mockResolvedValue([{
          id: "calendar-slot-1",
          clinicId: clinic.id,
          professionalId: null,
          startsAt: new Date("2026-08-18T18:00:00.000Z"),
          endsAt: new Date("2026-08-18T19:00:00.000Z"),
          source: "manual",
        }]),
      },
      state: {
        getCurrentState: currentState,
        offerSlotsForTurn: vi.fn().mockResolvedValue([{
          index: 1,
          startsAt: "2026-08-18T18:00:00.000Z",
          endsAt: "2026-08-18T19:00:00.000Z",
          label: "Ter 18/08 às 15h",
        }]),
        invalidateIfCurrent: options.cleanupFailure
          ? vi.fn().mockRejectedValue(new Error("cleanup unavailable"))
          : vi.fn().mockResolvedValue(true),
      },
      appointments: {
        findByPeriod: vi.fn().mockResolvedValue([]),
        findByIdForClinicAndLead: vi.fn(),
      },
      reservations: { findActiveByPeriod: vi.fn().mockResolvedValue([]) },
      booking,
    },
    resolveTurnConfiguration: vi.fn().mockReturnValue({
      gateInput: {
        automationEnabled: true,
        duplicate: false,
        humanControlled: options.nonPreparedStatus === "suppressed",
        optedOut: false,
      },
      policy: {
        priceDisclosureEnabled: true,
        humanEscalationRequired: false,
        schedulingMinimumLeadTimeHours: 2,
        schedulingRequiresEvaluationFirst: false,
      },
      style: {
        tone: "warm",
        verbosity: "concise",
        greeting: "omit",
        emoji: "none",
      },
      useVoice: false,
      ttsConfig: { provider: "nova", speed: 0.92 },
    }),
    outbound: {
      outboundMessageStore: {
        createOutboundMessageAndEnqueue,
        createOutboundMessage: vi.fn(),
      } as never,
      jobQueue: { enqueueJob: vi.fn() } as never,
    },
    decisionTraceSink: trace,
    now: options.clockFailure
      ? () => { throw new Error("clock unavailable"); }
      : () => new Date(now),
  });
  return {
    handler,
    lifecycle,
    releaseLease,
    understand,
    booking,
    createOutboundMessageAndEnqueue,
    trace,
  };
}

describe("V2LiveConversationHandler", () => {
  it("runs the real prepared pipeline and enqueues one authorized current-version reply", async () => {
    const harness = makeHarness();

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({ replied: true });

    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: clinic.id,
        conversationId: conversation.id,
        dedupeKey: `conversation-reply:${turnId}`,
        payload: expect.objectContaining({
          version: 1,
          kind: "conversation_reply",
          turnId,
          to: lead.phone,
          agentMessagePersistence: "sender",
          replyText: expect.stringContaining("R$ 800,00"),
        }),
      }),
      { turnId },
    );
    expect(harness.lifecycle.complete).toHaveBeenCalledTimes(1);
    expect(harness.releaseLease).toHaveBeenCalledTimes(1);
  });

  it.each(["duplicate", "busy"] as const)(
    "does not understand, execute, or enqueue a %s turn",
    async (beginOutcome) => {
      const harness = makeHarness({ beginOutcome });

      await expect(harness.handler.handle(handleInput())).resolves.toEqual({
        replied: false,
        reason: beginOutcome === "duplicate" ? "duplicate" : "conversation_busy",
      });
      expect(harness.understand).not.toHaveBeenCalled();
      expect(harness.createOutboundMessageAndEnqueue).not.toHaveBeenCalled();
      expect(harness.lifecycle.complete).not.toHaveBeenCalled();
    },
  );

  it("fails safely before effects when understanding fails and releases the lease", async () => {
    const harness = makeHarness({ understandingFailure: true });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "understanding_failed",
    });
    expect(harness.booking.book).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).not.toHaveBeenCalled();
    expect(harness.lifecycle.fail).toHaveBeenCalledTimes(1);
    expect(harness.releaseLease).toHaveBeenCalledTimes(1);
    expect(harness.trace.getEvents(turnId).at(-1)).toMatchObject({
      stage: "turn.failed",
      metadata: {
        phase: "understanding",
        reason: "understanding_failed",
        effectAttempted: false,
        effectCompleted: false,
      },
    });
    expect(JSON.stringify(harness.trace.getEvents(turnId))).not.toContain("private text");
  });

  it("classifies tenant reads before understanding as decision failure", async () => {
    const harness = makeHarness({ decisionFailure: true });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "decision_failed",
    });
    expect(harness.understand).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).not.toHaveBeenCalled();
    expect(harness.trace.getEvents(turnId).at(-1)).toMatchObject({
      stage: "turn.failed",
      metadata: expect.objectContaining({ phase: "decision", reason: "decision_failed" }),
    });
  });

  it.each([
    ["suppressed", "suppressed", "human_controlled"],
    ["needs_clarification", "needs_clarification", "no_safe_response"],
    ["escalated", "escalated", "no_safe_response"],
  ] as const)(
    "terminates %s without mislabeling it as a technical decision failure",
    async (nonPreparedStatus, traceStatus, reason) => {
      const harness = makeHarness({ nonPreparedStatus });

      await expect(harness.handler.handle(handleInput())).resolves.toEqual({
        replied: false,
        reason,
      });
      expect(harness.createOutboundMessageAndEnqueue).not.toHaveBeenCalled();
      expect(harness.lifecycle.fail).not.toHaveBeenCalled();
      expect(harness.lifecycle.complete).toHaveBeenCalledWith(expect.objectContaining({
        replied: false,
        reason,
      }));
      expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stage: "v2.decision",
          metadata: expect.objectContaining({ status: traceStatus }),
        }),
      ]));
    },
  );

  it("never retries or inverts a completed action when the durable outbox fails", async () => {
    const harness = makeHarness({ bookingTurn: true, outboxFailure: true });

    await expect(harness.handler.handle(handleInput("Pode marcar a primeira opção?")))
      .rejects.toThrow("outbox unavailable");

    expect(harness.booking.book).toHaveBeenCalledTimes(1);
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.complete).not.toHaveBeenCalled();
    expect(harness.lifecycle.fail).toHaveBeenCalledTimes(1);
    expect(harness.releaseLease).toHaveBeenCalledTimes(1);
    expect(harness.trace.getEvents(turnId).at(-1)).toMatchObject({
      stage: "turn.failed",
      metadata: {
        phase: "outbox",
        reason: "outbox_failed",
        effectAttempted: true,
        effectCompleted: true,
      },
    });
  });

  it("keeps one successful booking response when non-authoritative cleanup fails", async () => {
    const harness = makeHarness({ bookingTurn: true, cleanupFailure: true });

    await expect(harness.handler.handle(handleInput("Pode marcar a primeira opção?")))
      .resolves.toEqual({ replied: true });

    expect(harness.booking.book).toHaveBeenCalledTimes(1);
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "v2.action_result",
        metadata: expect.objectContaining({ completedEffectCount: 1 }),
      }),
    ]));
  });

  it("tracks persisted slot offers as an attempted and completed action without retry", async () => {
    const harness = makeHarness({ schedulingOfferTurn: true, outboxFailure: true });

    await expect(harness.handler.handle(handleInput("Tem horário amanhã?")))
      .rejects.toThrow("outbox unavailable");

    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.trace.getEvents(turnId).at(-1)).toMatchObject({
      stage: "turn.failed",
      metadata: {
        phase: "outbox",
        reason: "outbox_failed",
        effectAttempted: true,
        effectCompleted: true,
      },
    });
  });

  it("rejects an unknown understanding model before provider use and never traces its value", async () => {
    const secretModel = "secret-model-api-key-sk-live";
    const harness = makeHarness({ modelId: secretModel as never });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "understanding_failed",
    });
    expect(harness.understand).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.trace.getEvents(turnId))).not.toContain(secretModel);
    expect(harness.releaseLease).toHaveBeenCalledOnce();
  });

  it("releases the ready lease when the turn clock throws", async () => {
    const harness = makeHarness({ clockFailure: true });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "decision_failed",
    });
    expect(harness.lifecycle.fail).toHaveBeenCalledOnce();
    expect(harness.releaseLease).toHaveBeenCalledOnce();
  });

  it("emits only allowlisted structural V2 trace metadata", async () => {
    const harness = makeHarness();
    await harness.handler.handle(handleInput());

    const events = harness.trace.getEvents(turnId).filter(({ stage }) => stage.startsWith("v2."));
    expect(events.map(({ stage }) => stage)).toEqual([
      "v2.understanding",
      "v2.decision",
      "v2.action_result",
      "v2.outbox",
    ]);
    expect(harness.trace.getEvents(turnId).some(({ stage }) => stage === "engine.selected"))
      .toBe(false);
    expect(events).toEqual(events.map(() => expect.objectContaining({
      metadata: expect.not.objectContaining({
        text: expect.anything(),
        phone: expect.anything(),
        evidenceRef: expect.anything(),
        serviceId: expect.anything(),
        appointmentId: expect.anything(),
      }),
    })));
  });
});
