import { describe, expect, it, vi } from "vitest";
import { createDentalJourneyLiveAdapter } from "@/application/conversation-v2/dental-journey-live-adapter";
import type { ConversationStateRow } from "@/core/conversation/ConversationStateMachine";
import type { Treatment } from "@/domain/entities/treatment";

const now = new Date("2026-09-02T12:00:00.000Z");
const treatment: Treatment = {
  id: "treatment-1",
  clinicId: "clinic-1",
  name: "Lentes",
  aliases: ["lentes de resina"],
  durationMinutes: 60,
  description: "Descrição",
  requiresEvaluationFirst: false,
  keywordMatchEnabled: true,
  isAesthetic: true,
  pipelineSteps: [{
    type: "content",
    label: "Como funciona",
    blocks: [
      { kind: "text", content: "Primeiro texto." },
      { kind: "media", mediaId: "media-1", caption: "Veja o exemplo." },
      { kind: "text", content: "Depois do vídeo." },
    ],
  }, {
    type: "photo",
    label: "Sua foto",
    message: "Envie uma foto para avaliação.",
    required: true,
  }],
  pipelineSourceTreatmentId: null,
  pipelineEntryBehavior: "immediate",
  priceCents: 100_000,
  minPriceCents: null,
  maxPriceCents: null,
  priceQuotableInChat: true,
  priceKind: "fixed",
  priceUnit: null,
  priceDeductible: false,
  createdAt: now,
  updatedAt: now,
};

function harness(mediaClinicId = "clinic-1") {
  let current: ConversationStateRow | null = null;
  const state = {
    getCurrentState: vi.fn(async () => current),
    startTreatmentPipelineForTurn: vi.fn(async (input: {
      conversationId: string;
      treatmentId: string;
      treatmentName: string;
      stepIndex: number;
    }) => {
      current = {
        id: "state-journey-1",
        conversationId: input.conversationId,
        state: "treatment_pipeline_active",
        payload: {
          treatmentId: input.treatmentId,
          treatmentName: input.treatmentName,
          stepIndex: input.stepIndex,
          qaTurns: 0,
          photoReceived: false,
        },
        supersedesStateId: null,
        createdAt: now,
        expiresAt: new Date("2026-09-02T16:00:00.000Z"),
      };
      return { applied: true, state: current };
    }),
    markPipelinePhotoReceived: vi.fn(),
    getDepositState: vi.fn().mockResolvedValue(null),
    markDepositProofReceived: vi.fn(),
    invalidate: vi.fn(),
  };
  const adapter = createDentalJourneyLiveAdapter({
    clinicId: "clinic-1",
    conversationId: "conversation-1",
    turnId: "turn-1",
    now,
    inboundMessage: {
      id: "message-1",
      mediaType: null,
    },
    history: [],
    treatments: {
      listByClinic: vi.fn().mockResolvedValue([treatment]),
    },
    mediaAssets: {
      findByIds: vi.fn().mockResolvedValue([{
        id: "media-1",
        clinicId: mediaClinicId,
        treatmentId: treatment.id,
        title: "Vídeo de exemplo",
        url: "https://media.invalid/video.mp4",
        type: "video",
      }]),
    },
    state,
    reservations: {
      release: vi.fn(),
      extend: vi.fn(),
    },
  } as never);
  return { adapter, state };
}

describe("dental journey live adapter", () => {
  it("preserves configured text-media-text order and defers the exact advance", async () => {
    const { adapter, state } = harness();
    const resolution = await adapter.journeyRead.resolveStart("Lentes");
    expect(resolution).toMatchObject({
      kind: "ready",
      subjectId: "treatment-1:step:0",
      subjectLabel: "Como funciona",
    });
    if (resolution.kind !== "ready") throw new Error("expected ready journey");

    const outcome = await adapter.journeyWrite.prepareStep(resolution.resolutionId);
    const plan = adapter.journeyWrite.takeDeliveryPlan();

    expect(outcome).toMatchObject({ success: true, kind: "journey_step_ready" });
    expect(state.startTreatmentPipelineForTurn).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      turnId: "turn-1",
      treatmentId: "treatment-1",
      treatmentName: "Lentes",
      ttlMinutes: 240,
      stepIndex: 0,
      selectedTreatment: null,
      expectedCurrentStateId: null,
    });
    expect(plan).toEqual({
      replyText: "Primeiro texto.\n\nDepois do vídeo.",
      interleavedParts: [
        { type: "text", content: "Primeiro texto." },
        {
          type: "media",
          mediaId: "media-1",
          url: "https://media.invalid/video.mp4",
          mediaType: "video",
          title: "Vídeo de exemplo",
          caption: "Veja o exemplo.",
        },
        { type: "text", content: "Depois do vídeo." },
      ],
      pipelineAdvance: {
        action: "advance",
        nextStepIndex: 1,
        expectedTreatmentId: "treatment-1",
        expectedStepIndex: 0,
      },
      deterministic: true,
    });
  });

  it("fails closed before state or delivery when a media row belongs to another tenant", async () => {
    const { adapter, state } = harness("clinic-other");
    const resolution = await adapter.journeyRead.resolveStart("Lentes");

    expect(resolution).toEqual({
      kind: "unavailable",
      reason: "journey_media_tenant_mismatch",
    });
    expect(state.startTreatmentPipelineForTurn).not.toHaveBeenCalled();
    expect(adapter.journeyWrite.takeDeliveryPlan()).toBeNull();
  });

  it("consumes a delivery plan once", async () => {
    const { adapter } = harness();
    const resolution = await adapter.journeyRead.resolveStart("Lentes");
    if (resolution.kind !== "ready") throw new Error("expected ready journey");
    await adapter.journeyWrite.prepareStep(resolution.resolutionId);

    expect(adapter.journeyWrite.takeDeliveryPlan()).not.toBeNull();
    expect(adapter.journeyWrite.takeDeliveryPlan()).toBeNull();
  });
});
