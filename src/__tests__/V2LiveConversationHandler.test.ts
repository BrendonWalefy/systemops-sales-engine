import { describe, expect, it, vi } from "vitest";
import { V2_SAFE_FAILURE_REPLY_TEXT } from "@/application/conversation-v2/v2-safe-failure-reply";
import type { LiveTurnContext, LiveTurnSnapshot } from "@/application/conversation/live-turn-lifecycle";
import { V2LiveConversationHandler } from "@/application/conversation-v2/v2-live-conversation-handler";
import { UNDERSTANDING_VERSION } from "@/conversation-core/understanding/schema";
import { InMemoryDecisionTraceSink } from "@/core/observability/DecisionTrace";
import type { Organization } from "@/domain/entities/clinic";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { Treatment } from "@/domain/entities/treatment";
import { createLiveDentalUnderstanding } from "@/infrastructure/adapters/ai/live-dental-understanding";
import { createLiveResponseVerbalizer } from "@/infrastructure/adapters/ai/live-response-verbalizer";

const now = new Date("2026-08-17T12:00:00.000Z");
const turnId = "turn-v2-live-1";
const inboundEventId = "91eca071-354d-48a2-848d-dee2a7029e16";

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
  invalidBookingBinding?: boolean;
  outboxFailure?: boolean;
  handoffFailure?: boolean;
  lifecycleFailure?: boolean;
  clockFailure?: boolean;
  modelId?: "gpt-4o-mini";
  canonicalProviderSpoof?: boolean;
  nonPreparedStatus?: "suppressed" | "needs_clarification" | "escalated";
  deriveReplyGate?: boolean;
  safetyOptOut?: boolean;
  verbalizedText?: string;
  verbalizerFailure?: boolean;
  crossTenantTreatment?: boolean;
  safeHandoffBehavior?: "objections" | "cancel_reschedule";
  understandingRawOutput?: string | null;
  evidenceCaptureStatus?: "stored" | "persistence_failed";
  businessInformationTurn?: boolean;
  businessInformationMissing?: boolean;
  businessInformationTopic?: "address" | "parking" | "social";
  editorialFaq?: boolean;
  playbookKnowledgeTurn?: "differentials" | "faq";
} = {}) {
  const entities = (overrides: Record<string, unknown> = {}) => ({
    service: null,
    businessInformationTopic: null,
    date: null,
    period: null,
    time: null,
    serviceCandidates: null,
    faqQuestion: null,
    quantity: null,
    quantityScope: null,
    objectionQuestion: null,
    ordinal: null,
    ...overrides,
  });
  const signals = (overrides: Record<string, unknown> = {}) => ({
    purchaseIntent: null,
    priceSensitivity: null,
    sentiment: null,
    objection: null,
    ...overrides,
  });
  const safety = (overrides: Record<string, boolean> = {}) => ({
    optOut: false,
    requestsHuman: false,
    emergency: false,
    ...overrides,
  });
  const releaseLease = vi.fn().mockResolvedValue(undefined);
  const turnClinic = options.businessInformationTurn
    ? {
        ...clinic,
        address: options.businessInformationMissing ? null : "Avenida Aurora, 321",
        addressComplement: null,
        locationMessage: null,
        parkingInformation: options.businessInformationMissing ? null : "Vagas conveniadas ao lado.",
        socialChannels: options.businessInformationMissing
          ? null
          : [{ label: "Instagram", url: "https://instagram.com/systemops" }],
      }
    : clinic;
  const context: LiveTurnContext = Object.freeze({
    turnId,
    clinicId: clinic.id,
    leadId: lead.id,
    conversationId: conversation.id,
    inboundMessageId: inbound.id,
    clinic: turnClinic,
    lead,
    conversation,
    inboundMessage: inbound,
    outboundAddress: lead.phone!,
    editorial: options.editorialFaq || options.playbookKnowledgeTurn
      ? ({
          versionId: "version-active-7",
          differentials: ["Atendimento individualizado.", "Planejamento digital."],
          faqs: [
          { question: "Preciso de encaminhamento?", answer: "Não." },
          { question: "Aceita convênio?", answer: "Consulte a recepção." },
        ],
          objections: [{ objection: "Está caro?", response: "Podemos parcelar." }],
        } as never)
      : null,
    inboundAuthority: {
      inboundEventId,
      streamId: "d4d87572-92e8-4865-a1fc-fc9b53fd4f34",
      streamGeneration: 1,
      claimJobId: "097cad6b-c6f6-4d15-8118-5e10aeb814dc",
      claimToken: "A".repeat(43),
    },
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
    fail: options.lifecycleFailure
      ? vi.fn().mockRejectedValue(new Error("lifecycle unavailable"))
      : vi.fn().mockResolvedValue(undefined),
  };
  const understand = vi.fn().mockImplementation(async () => {
    if (options.understandingFailure) throw new Error("model payload with private text");
    if (options.nonPreparedStatus === "needs_clarification") {
      return {
        version: UNDERSTANDING_VERSION,
        request: "price-of-service" as const,
        dialogueMove: "new_topic" as const,
        entities: entities(),
        signals: signals(), safety: safety(), confidence: 1, ambiguity: null,
      } as never;
    }
    const turnSafety = options.safetyOptOut
      ? safety({ optOut: true })
      : options.nonPreparedStatus === "escalated"
      ? safety({ requestsHuman: true })
      : safety();
    if (options.schedulingOfferTurn) {
      return {
        version: UNDERSTANDING_VERSION,
        request: "book-appointment" as const,
        dialogueMove: "new_topic" as const,
        entities: entities({ service: "clareamento", date: "amanhã", period: "afternoon" }),
        signals: signals(), safety: turnSafety, confidence: 1, ambiguity: null,
      };
    }
    if (options.businessInformationTurn) {
      return {
        version: UNDERSTANDING_VERSION,
        request: "business-information" as const,
        dialogueMove: "new_topic" as const,
        entities: entities({ businessInformationTopic: options.businessInformationTopic ?? "address" }),
        signals: signals(), safety: turnSafety, confidence: 1, ambiguity: null,
      };
    }
    if (options.playbookKnowledgeTurn === "differentials") {
      return {
        version: UNDERSTANDING_VERSION,
        request: "business-differentials" as const,
        dialogueMove: "new_topic" as const,
        entities: entities(),
        signals: signals(), safety: turnSafety, confidence: 1, ambiguity: null,
      };
    }
    if (options.playbookKnowledgeTurn === "faq") {
      return {
        version: UNDERSTANDING_VERSION,
        request: "frequently-asked-question" as const,
        dialogueMove: "new_topic" as const,
        entities: entities({ faqQuestion: "Preciso de encaminhamento?" }),
        signals: signals(), safety: turnSafety, confidence: 1, ambiguity: null,
      };
    }
    if (options.safeHandoffBehavior === "objections") {
      return {
        version: UNDERSTANDING_VERSION,
        request: "other" as const,
        dialogueMove: "new_topic" as const,
        entities: entities(),
        signals: signals({ objection: "price" }), safety: turnSafety, confidence: 1, ambiguity: null,
      };
    }
    if (options.safeHandoffBehavior === "cancel_reschedule") {
      return {
        version: UNDERSTANDING_VERSION,
        request: "cancel-appointment" as const,
        dialogueMove: "new_topic" as const,
        entities: entities(),
        signals: signals(), safety: turnSafety, confidence: 1, ambiguity: null,
      };
    }
    return options.bookingTurn
      ? {
          version: UNDERSTANDING_VERSION,
          request: "confirm-slot" as const,
          dialogueMove: "answers_pending" as const,
          entities: entities({ ordinal: 1 }),
          signals: signals(), safety: turnSafety, confidence: 1, ambiguity: null,
        }
      : {
          version: UNDERSTANDING_VERSION,
          request: "price-of-service" as const,
          dialogueMove: "new_topic" as const,
          entities: entities({ service: "clareamento" }),
          signals: signals(), safety: turnSafety, confidence: 1, ambiguity: null,
        };
  });
  const appointment = {
    id: "appointment-1",
    clinicId: options.invalidBookingBinding ? "wrong-clinic" : clinic.id,
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
  const persistStopContact = vi.fn().mockResolvedValue(undefined);
  const persistHandoff = options.handoffFailure
    ? vi.fn().mockRejectedValue(new Error("handoff unavailable"))
    : vi.fn().mockResolvedValue(undefined);
  const understandingCreate = vi.fn(async (input: unknown) => {
    void input;
    return { choices: [{
      message: {
        content: Object.hasOwn(options, "understandingRawOutput")
          ? options.understandingRawOutput ?? null
          : JSON.stringify(await understand()),
      },
    }] };
  });
  const registeredUnderstanding = createLiveDentalUnderstanding({
    chat: {
      completions: { create: understandingCreate },
    },
  });
  const understandingBoundary = options.canonicalProviderSpoof || options.modelId
    ? ({
        modelId: options.modelId ?? "gpt-4o-mini",
        understand,
      } as never)
    : registeredUnderstanding;
  const verbalize = vi.fn(async () => {
    if (options.verbalizerFailure) throw new Error("provider down");
    return options.verbalizedText;
  });
  const verbalizerCreate = vi.fn(async (input: unknown) => {
    void input;
    return {
      choices: [{ message: { content: JSON.stringify({ text: await verbalize() }) } }],
    };
  });
  const verbalizer = options.verbalizedText !== undefined || options.verbalizerFailure
    ? createLiveResponseVerbalizer({
        chat: { completions: { create: verbalizerCreate } },
      })
    : undefined;
  const rejectionCapture = vi.fn().mockResolvedValue(
    options.evidenceCaptureStatus === "persistence_failed"
      ? { status: "persistence_failed" as const }
      : { status: "stored" as const, evidenceRef: "opaque-evidence-ref" },
  );
  const listTreatments = options.decisionFailure
    ? vi.fn().mockRejectedValue(new Error("catalog unavailable"))
    : vi.fn().mockResolvedValue([
        options.crossTenantTreatment
          ? { ...treatment, clinicId: "clinic-other" }
          : treatment,
      ]);
  const handler = new V2LiveConversationHandler({
    lifecycle,
    understanding: understandingBoundary,
    verbalizer,
    dental: {
      treatments: {
        listByClinic: listTreatments,
      },
      resolveTenantScheduling: vi.fn((claimedClinicId: string) => {
        if (claimedClinicId !== clinic.id) throw new Error("cross-tenant scheduling");
        return {
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
          booking,
        };
      }),
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
    },
    resolveTurnConfiguration: vi.fn().mockImplementation((resolutionInput) => ({
      gateInput: {
        automationEnabled: options.deriveReplyGate
          ? resolutionInput.turnInput.replyEnabled !== false
            && resolutionInput.turnInput.automationMode === "live"
          : true,
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
      speaker: {
        agentName: "Marina",
        organizationName: clinic.name,
        specialty: null,
        toneOfVoice: "acolhedor",
        guidelines: [],
      },
      useVoice: false,
      ttsConfig: { provider: "nova", speed: 0.92 },
    })),
    outbound: {
      outboundMessageStore: {
        createOutboundMessageAndEnqueue,
        createOutboundMessage: vi.fn(),
      } as never,
      jobQueue: { enqueueJob: vi.fn() } as never,
    },
    decisionTraceSink: trace,
    aiContractRejectionRecorder: { capture: rejectionCapture },
    persistStopContact,
    persistHandoff,
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
    persistStopContact,
    persistHandoff,
    trace,
    verbalize,
    understandingCreate,
    verbalizerCreate,
    rejectionCapture,
    listTreatments,
  };
}

describe("V2LiveConversationHandler", () => {
  it.each([
    ["differentials", "Atendimento individualizado"],
    ["faq", "Não."],
  ] as const)("answers active playbook %s without business effects", async (turn, expected) => {
    const harness = makeHarness({ playbookKnowledgeTurn: turn });

    await expect(harness.handler.handle(handleInput("Pergunta de conhecimento")))
      .resolves.toEqual({ replied: true });

    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ replyText: expect.stringContaining(expected) }),
      }),
      { turnId },
    );
    expect(harness.booking.book).not.toHaveBeenCalled();
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "v2.decision",
        metadata: expect.objectContaining({
          capabilityIds: "dental-playbook-knowledge",
          intendedEffects: "none",
        }),
      }),
    ]));
    expect(JSON.stringify(harness.trace.getEvents(turnId))).not.toContain(expected);
  });

  it("supplies only bounded canonical FAQ questions to Understanding", async () => {
    const harness = makeHarness({ editorialFaq: true });

    await harness.handler.handle(handleInput());

    const openAiRequest = harness.understandingCreate.mock.calls[0]![0] as {
      messages: { content: string }[];
    };
    const modelInput = JSON.parse(openAiRequest.messages[1]!.content);
    expect(modelInput.faqCatalog).toEqual([
      "Preciso de encaminhamento?",
      "Aceita convênio?",
    ]);
    expect(modelInput.objectionCatalog).toEqual(["Está caro?"]);
    expect(JSON.stringify(modelInput)).not.toContain("Consulte a recepção");
    expect(JSON.stringify(modelInput)).not.toContain("Podemos parcelar");
  });

  it("answers institutional knowledge through the generic read-only pipeline", async () => {
    const privateAddress = "Avenida Aurora, 321";
    const harness = makeHarness({
      businessInformationTurn: true,
      verbalizedText: `Ficamos na ${privateAddress}.`,
    });

    await expect(harness.handler.handle(handleInput("Onde vocês ficam?")))
      .resolves.toEqual({ replied: true });

    expect(harness.understandingCreate).toHaveBeenCalledOnce();
    expect(harness.verbalizerCreate).toHaveBeenCalledOnce();
    expect(harness.listTreatments).toHaveBeenCalledOnce();
    expect(harness.booking.book).not.toHaveBeenCalled();
    expect(harness.persistStopContact).not.toHaveBeenCalled();
    expect(harness.persistHandoff).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledOnce();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          replyText: `Ficamos na ${privateAddress}.`,
        }),
      }),
      { turnId },
    );
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "v2.decision",
        metadata: expect.objectContaining({
          capabilityIds: "dental-knowledge",
          decisionKinds: "answer",
          intendedEffects: "none",
        }),
      }),
      expect.objectContaining({
        stage: "v2.action_result",
        metadata: expect.objectContaining({
          outcomeTypes: "business_information_answered",
          completedEffectCount: 0,
        }),
      }),
    ]));
    expect(JSON.stringify(harness.trace.getEvents(turnId))).not.toContain(privateAddress);
  });

  it("asks safely when institutional information is not registered", async () => {
    const harness = makeHarness({
      businessInformationTurn: true,
      businessInformationMissing: true,
    });

    await expect(harness.handler.handle(handleInput("Qual é o endereço?")))
      .resolves.toEqual({ replied: true });

    expect(harness.understandingCreate).toHaveBeenCalledOnce();
    expect(harness.verbalizerCreate).not.toHaveBeenCalled();
    expect(harness.booking.book).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledOnce();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          replyText: expect.stringContaining("endereço ainda não está cadastrado"),
        }),
      }),
      { turnId },
    );
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "v2.action_result",
        metadata: expect.objectContaining({
          outcomeTypes: "business_information_unavailable",
          completedEffectCount: 0,
        }),
      }),
    ]));
  });

  it("answers a structured social channel through the same read-only pipeline", async () => {
    const reply = "Nosso canal é Instagram: https://instagram.com/systemops.";
    const harness = makeHarness({
      businessInformationTurn: true,
      businessInformationTopic: "social",
      verbalizedText: reply,
    });

    await expect(harness.handler.handle(handleInput("Qual é o Instagram?")))
      .resolves.toEqual({ replied: true });

    expect(harness.understandingCreate).toHaveBeenCalledOnce();
    expect(harness.verbalizerCreate).toHaveBeenCalledOnce();
    expect(harness.booking.book).not.toHaveBeenCalled();
    expect(harness.persistHandoff).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledOnce();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ replyText: reply }) }),
      { turnId },
    );
  });

  it("suppresses a reaction/sticker turn from the real reply gate before provider and outbox", async () => {
    const harness = makeHarness({
      deriveReplyGate: true,
      verbalizedText: "Esta resposta nunca pode ser produzida.",
    });

    await expect(harness.handler.handle({
      ...handleInput("👍"),
      replyEnabled: false,
    })).resolves.toEqual({ replied: false, reason: "disabled" });

    expect(harness.understand).not.toHaveBeenCalled();
    expect(harness.verbalizerCreate).not.toHaveBeenCalled();
    expect(harness.booking.book).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).not.toHaveBeenCalled();
  });

  it("blocks compound stop-contact plus booking before scheduling and outbound", async () => {
    const harness = makeHarness({ schedulingOfferTurn: true, safetyOptOut: true });

    await expect(harness.handler.handle(
      handleInput("Não quero mais receber mensagens; mas marque clareamento amanhã"),
    )).resolves.toEqual({ replied: true, reason: "opted_out" });

    expect(harness.booking.book).not.toHaveBeenCalled();
    expect(harness.persistStopContact).toHaveBeenCalledWith(expect.objectContaining({
      leadId: lead.id,
      conversationId: conversation.id,
      clinicId: clinic.id,
      sourceInboundEventId: inboundEventId,
      decision: expect.objectContaining({ source: "lead_message" }),
    }));
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledOnce();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          intent: "stop_contact",
          replyText: expect.stringContaining("não vou mais te enviar mensagens"),
        }),
      }),
      { turnId },
    );
  });

  it("keeps a durable opt-out outbox failure classified as outbox_failed", async () => {
    const harness = makeHarness({ safetyOptOut: true, outboxFailure: true });

    await expect(harness.handler.handle(handleInput("Pare de me enviar mensagens")))
      .resolves.toEqual({ replied: false, reason: "outbox_failed" });
    expect(harness.persistStopContact).toHaveBeenCalledOnce();
    expect(harness.persistHandoff).toHaveBeenCalledWith({
      clinicId: clinic.id,
      conversationId: conversation.id,
      reason: "v2_effect_outbox_failure_requires_human",
      now,
    });
    expect(harness.lifecycle.fail).toHaveBeenCalledOnce();
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

  it.each([
    ["objections", "v2_objection_requires_human"],
    ["cancel_reschedule", "v2_cancel_reschedule_requires_human"],
  ] as const)(
    "persists the %s safe handoff with one stable tenant-scoped identity before replying",
    async (safeHandoffBehavior, reason) => {
      const harness = makeHarness({ safeHandoffBehavior });

      await expect(harness.handler.handle(handleInput())).resolves.toEqual({ replied: true });

      expect(harness.persistHandoff).toHaveBeenCalledOnce();
      expect(harness.persistHandoff).toHaveBeenCalledWith({
        clinicId: clinic.id,
        conversationId: conversation.id,
        reason,
        now,
      });
      expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledOnce();
    },
  );
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
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.createOutboundMessageAndEnqueue.mock.calls[0]?.[0]).toMatchObject({
      dedupeKey: `conversation-reply:${turnId}`,
      payload: expect.objectContaining({ replyText: V2_SAFE_FAILURE_REPLY_TEXT }),
    });
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

  it("captures rejected understanding output with exact durable tenant context", async () => {
    const privateOutput = "{rejected private model output";
    const harness = makeHarness({ understandingRawOutput: privateOutput });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "understanding_failed",
    });

    expect(harness.rejectionCapture).toHaveBeenCalledOnce();
    expect(harness.rejectionCapture).toHaveBeenCalledWith({
      organizationId: clinic.id,
      conversationId: conversation.id,
      inboundEventId,
      turnId: inboundEventId,
      stage: "understanding_structural",
      modelId: "gpt-4o-mini",
      promptVersion: "dental-understanding.v4",
      contractVersion: "understanding.v1",
      attempt: 1,
      rawOutput: privateOutput,
      issues: [{ path: [], code: "invalid_json" }],
      occurredAt: now,
    });
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledOnce();
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "v2.understanding",
        metadata: expect.objectContaining({
          errorCode: "output_invalid",
          rejectionStage: "understanding_structural",
          rejectionCodes: "invalid_json",
          evidenceCaptureStatus: "stored",
          evidenceRef: "opaque-evidence-ref",
        }),
      }),
    ]));
    expect(JSON.stringify(harness.trace.getEvents(turnId))).not.toContain(privateOutput);
  });

  it("does not capture accepted understanding or provider transport failure", async () => {
    const accepted = makeHarness();
    await accepted.handler.handle(handleInput());
    expect(accepted.rejectionCapture).not.toHaveBeenCalled();

    const providerFailure = makeHarness({ understandingFailure: true });
    await providerFailure.handler.handle(handleInput());
    expect(providerFailure.rejectionCapture).not.toHaveBeenCalled();
  });

  it("keeps the same safe fallback when rejection persistence fails", async () => {
    const harness = makeHarness({
      understandingRawOutput: "not-json-private-output",
      evidenceCaptureStatus: "persistence_failed",
    });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "understanding_failed",
    });
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledOnce();
    expect(harness.createOutboundMessageAndEnqueue.mock.calls[0]?.[0]).toMatchObject({
      payload: expect.objectContaining({ replyText: V2_SAFE_FAILURE_REPLY_TEXT }),
    });
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "v2.understanding",
        metadata: expect.objectContaining({
          evidenceCaptureStatus: "persistence_failed",
        }),
      }),
    ]));
  });

  it("classifies tenant reads before understanding as decision failure", async () => {
    const harness = makeHarness({ decisionFailure: true });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "decision_failed",
    });
    expect(harness.understand).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.createOutboundMessageAndEnqueue.mock.calls[0]?.[0]).toMatchObject({
      dedupeKey: `conversation-reply:${turnId}`,
      payload: expect.objectContaining({ replyText: V2_SAFE_FAILURE_REPLY_TEXT }),
    });
    expect(harness.trace.getEvents(turnId).at(-1)).toMatchObject({
      stage: "turn.failed",
      metadata: expect.objectContaining({ phase: "decision", reason: "decision_failed" }),
    });
  });

  it("rejects a cross-tenant catalog result before understanding or scheduling effects", async () => {
    const harness = makeHarness({ crossTenantTreatment: true });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "decision_failed",
    });
    expect(harness.understand).not.toHaveBeenCalled();
    expect(harness.booking.book).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledOnce();
    expect(harness.createOutboundMessageAndEnqueue.mock.calls[0]?.[0]).toMatchObject({
      payload: expect.objectContaining({ replyText: V2_SAFE_FAILURE_REPLY_TEXT }),
    });
  });

  it.each([
    ["suppressed", "suppressed", "human_controlled"],
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

  it("rejects a provider-invalid would-be clarification before decision execution", async () => {
    const harness = makeHarness({ nonPreparedStatus: "needs_clarification" });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "understanding_failed",
    });
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.createOutboundMessageAndEnqueue.mock.calls[0]?.[0]).toMatchObject({
      dedupeKey: `conversation-reply:${turnId}`,
      payload: expect.objectContaining({ replyText: V2_SAFE_FAILURE_REPLY_TEXT }),
    });
    expect(harness.lifecycle.fail).toHaveBeenCalledTimes(1);
    expect(harness.trace.getEvents(turnId).at(-1)).toMatchObject({
      stage: "turn.failed",
      metadata: expect.objectContaining({
        phase: "understanding",
        reason: "understanding_failed",
        safeReplyEnqueued: true,
      }),
    });
  });

  it("never retries or inverts a completed action when the durable outbox fails", async () => {
    const harness = makeHarness({ bookingTurn: true, outboxFailure: true });

    await expect(harness.handler.handle(handleInput("Pode marcar a primeira opção?")))
      .resolves.toEqual({ replied: false, reason: "outbox_failed" });

    expect(harness.booking.book).toHaveBeenCalledTimes(1);
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.lifecycle.complete).not.toHaveBeenCalled();
    expect(harness.lifecycle.fail).toHaveBeenCalledTimes(1);
    expect(harness.persistHandoff).toHaveBeenCalledOnce();
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

  it("keeps authoritative effect truth when post-booking binding validation fails", async () => {
    const harness = makeHarness({
      bookingTurn: true,
      invalidBookingBinding: true,
      outboxFailure: true,
    });

    await expect(harness.handler.handle(handleInput("Pode marcar a primeira opção?")))
      .resolves.toEqual({ replied: false, reason: "outbox_failed" });

    expect(harness.booking.book).toHaveBeenCalledOnce();
    expect(harness.trace.getEvents(turnId).at(-1)).toMatchObject({
      stage: "turn.failed",
      metadata: expect.objectContaining({
        phase: "outbox",
        effectAttempted: true,
        effectCompleted: true,
      }),
    });
  });

  it("tracks persisted slot offers as an attempted and completed action without retry", async () => {
    const harness = makeHarness({ schedulingOfferTurn: true, outboxFailure: true });

    await expect(harness.handler.handle(handleInput("Tem horário amanhã?")))
      .resolves.toEqual({ replied: false, reason: "outbox_failed" });

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

  it("retries the same turn when outbox fails before any effect", async () => {
    const harness = makeHarness({ outboxFailure: true });

    await expect(harness.handler.handle(handleInput()))
      .rejects.toThrow("outbox unavailable");
    expect(harness.persistHandoff).not.toHaveBeenCalled();
    expect(harness.booking.book).not.toHaveBeenCalled();
  });

  it("emits a closed terminal marker when effect handoff persistence is unavailable", async () => {
    const harness = makeHarness({
      bookingTurn: true,
      outboxFailure: true,
      handoffFailure: true,
    });

    await expect(harness.handler.handle(handleInput("Pode marcar a primeira opção?")))
      .rejects.toMatchObject({
        name: "V2TerminalHandoffRequiredError",
        message: "v2_terminal_handoff_required:effect_outbox_failed",
      });
    expect(harness.booking.book).toHaveBeenCalledOnce();
  });

  it("keeps the closed marker when lifecycle failure follows unavailable handoff", async () => {
    const harness = makeHarness({
      bookingTurn: true,
      outboxFailure: true,
      handoffFailure: true,
      lifecycleFailure: true,
    });

    await expect(harness.handler.handle(handleInput("Pode marcar a primeira opção?")))
      .rejects.toMatchObject({
        name: "V2TerminalHandoffRequiredError",
        message: "v2_terminal_handoff_required:effect_outbox_failed",
      });
    expect(harness.booking.book).toHaveBeenCalledOnce();
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

  it("rejects an unregistered provider even when it declares the canonical model", async () => {
    const harness = makeHarness({ canonicalProviderSpoof: true });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({
      replied: false,
      reason: "understanding_failed",
    });
    expect(harness.understand).not.toHaveBeenCalled();
    expect(harness.createOutboundMessageAndEnqueue).not.toHaveBeenCalled();
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

    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "v2.decision",
        metadata: expect.objectContaining({
          capabilityIds: "dental-catalog",
          decisionKinds: "answer",
          intendedEffects: "none",
        }),
      }),
      expect.objectContaining({
        stage: "v2.action_result",
        metadata: expect.objectContaining({
          outcomeTypes: "catalog_answered",
          semanticClasses: "information_authorized",
        }),
      }),
      expect.objectContaining({
        stage: "response.plan_built",
        metadata: expect.objectContaining({
          action: "v2_response",
          planVersion: "authorized-response-plan.v2",
          outcomeRefs: "outcome-0",
          evidenceRefs: "evidence-0",
          allowedPriceCount: 1,
        }),
      }),
      expect.objectContaining({
        stage: "response.validated",
        metadata: expect.objectContaining({
          action: "v2_response",
          valid: true,
          violationCount: 0,
          violations: "",
          source: "draft",
          model: "deterministic-v2",
        }),
      }),
    ]));
  });

  it("entrega ao lead a prosa do modelo quando ela cabe no plano autorizado", async () => {
    const harness = makeHarness({
      verbalizedText: "O clareamento fica R$ 800,00.",
    });

    await harness.handler.handle(handleInput());

    expect(harness.understandingCreate).toHaveBeenCalledOnce();
    expect(harness.verbalizerCreate).toHaveBeenCalledOnce();
    const verbalizerCall = harness.verbalizerCreate.mock.calls[0]?.[0] as
      | { messages: readonly { content: string }[] }
      | undefined;
    if (!verbalizerCall?.messages[1]) throw new Error("missing verbalizer request");
    const verbalizerPayload = JSON.parse(verbalizerCall.messages[1].content) as Record<string, unknown>;
    expect(verbalizerPayload).toMatchObject({
      conversationBrief: {
        request: "price-of-service",
        dialogueMove: "new_topic",
        sentiment: null,
        purchaseIntent: null,
        priceSensitivity: null,
        hasObjection: false,
        ambiguityKind: null,
      },
    });

    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          replyText: "O clareamento fica R$ 800,00.",
        }),
      }),
      expect.anything(),
    );
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "response.validated",
        metadata: expect.objectContaining({
          valid: true,
          model: "gpt-4o-mini",
          verbalizationViolations: "",
          responseStrategy: "hybrid_contextual_v1",
          understandingCalls: 1,
          verbalizationCalls: 1,
        }),
      }),
    ]));
  });

  it("recusa a prosa que inventa preço e responde com o texto autorizado", async () => {
    const rejectedText = "Fecho para você por R$ 199,00 hoje.";
    const harness = makeHarness({ verbalizedText: rejectedText });

    await harness.handler.handle(handleInput());

    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          replyText: expect.stringContaining("R$ 800,00"),
        }),
      }),
      expect.anything(),
    );
    expect(harness.createOutboundMessageAndEnqueue).not.toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ replyText: expect.stringContaining("199") }),
      }),
      expect.anything(),
    );
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "response.validated",
        metadata: expect.objectContaining({
          valid: true,
          model: "deterministic-fallback",
          promptVersion: "deterministic-renderer.v1",
          verbalizationViolations: "missing_authorized_value,unauthorized_number",
        }),
      }),
    ]));
    expect(harness.rejectionCapture).toHaveBeenCalledOnce();
    expect(harness.rejectionCapture).toHaveBeenCalledWith({
      organizationId: clinic.id,
      conversationId: conversation.id,
      inboundEventId,
      turnId: inboundEventId,
      stage: "response_verbalization",
      modelId: "gpt-4o-mini",
      promptVersion: "response-verbalization.v9",
      contractVersion: "response-verbalization.v1",
      attempt: 1,
      rawOutput: rejectedText,
      issues: [
        { path: [], code: "missing_authorized_value" },
        { path: [], code: "unauthorized_number" },
      ],
      occurredAt: now,
    });
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "response.validated",
        metadata: expect.objectContaining({
          rejectionStage: "response_verbalization",
          rejectionCodes: "missing_authorized_value,unauthorized_number",
          evidenceCaptureStatus: "stored",
          evidenceRef: "opaque-evidence-ref",
        }),
      }),
    ]));
    expect(JSON.stringify(harness.trace.getEvents(turnId))).not.toContain(rejectedText);
  });

  it("keeps the authorized response when rejected verbalization evidence cannot persist", async () => {
    const harness = makeHarness({
      verbalizedText: "Fecho para você por R$ 199,00 hoje.",
      evidenceCaptureStatus: "persistence_failed",
    });

    await expect(harness.handler.handle(handleInput())).resolves.toEqual({ replied: true });
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          replyText: expect.stringContaining("R$ 800,00"),
        }),
      }),
      expect.anything(),
    );
    expect(harness.trace.getEvents(turnId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stage: "response.validated",
        metadata: expect.objectContaining({
          evidenceCaptureStatus: "persistence_failed",
        }),
      }),
    ]));
  });

  it("responde mesmo quando o verbalizador quebra", async () => {
    const harness = makeHarness({ verbalizerFailure: true });

    const result = await harness.handler.handle(handleInput());

    expect(result).toEqual({ replied: true });
    expect(harness.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          replyText: expect.stringContaining("R$ 800,00"),
        }),
      }),
      expect.anything(),
    );
  });
});
