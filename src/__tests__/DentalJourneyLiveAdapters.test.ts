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

function harness(
  mediaClinicId = "clinic-1",
  flow: "start" | "photo" | "deposit" | "proof_received" = "start",
) {
  let current: ConversationStateRow | null = flow === "photo"
    ? {
        id: "state-photo-1",
        conversationId: "conversation-1",
        state: "treatment_pipeline_active",
        payload: {
          treatmentId: treatment.id,
          treatmentName: treatment.name,
          stepIndex: 1,
          qaTurns: 0,
          photoReceived: false,
        },
        supersedesStateId: null,
        createdAt: now,
        expiresAt: new Date("2026-09-02T16:00:00.000Z"),
      }
    : flow === "deposit" || flow === "proof_received"
      ? {
          id: "state-deposit-1",
          conversationId: "conversation-1",
          state: flow === "deposit" ? "awaiting_deposit_proof" : "deposit_proof_received",
          payload: {
            slotStartsAt: "2026-09-03T12:00:00.000Z",
            slotEndsAt: "2026-09-03T13:00:00.000Z",
            slotLabel: "quinta às 09h",
            reservationId: "reservation-1",
            treatmentId: treatment.id,
            treatmentName: treatment.name,
            valueCents: 100_000,
            depositAmountCents: 20_000,
            holdExpiresAt: "2026-09-03T00:00:00.000Z",
          },
          supersedesStateId: null,
          createdAt: now,
          expiresAt: new Date("2026-09-03T00:00:00.000Z"),
        }
      : null;
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
    markPipelinePhotoReceivedForTurn: vi.fn(async (input: { sourceMessageId: string }) => {
      current = {
        ...current!,
        id: "state-photo-received",
        payload: {
          ...(current!.payload as Record<string, unknown>),
          photoReceived: true,
          photoMessageId: input.sourceMessageId,
          photoReceivedAt: now.toISOString(),
        },
        supersedesStateId: current!.id,
      };
      return { applied: true, state: current };
    }),
    getDepositState: vi.fn().mockResolvedValue(null),
    markDepositProofReceivedForTurn: vi.fn(async (input: {
      sourceMessageId: string;
      proofReviewCode: number;
    }) => {
      current = {
        ...current!,
        id: "state-proof-received",
        state: "deposit_proof_received",
        payload: {
          ...(current!.payload as Record<string, unknown>),
          proofMessageId: input.sourceMessageId,
          proofReviewCode: input.proofReviewCode,
          proofReceivedAt: now.toISOString(),
        },
        supersedesStateId: current!.id,
      };
      return { applied: true, state: current };
    }),
    invalidateIfCurrent: vi.fn().mockResolvedValue(true),
  };
  const reservations = {
    release: vi.fn(),
    extend: vi.fn(),
    findById: vi.fn().mockResolvedValue({
      id: "reservation-1",
      clinicId: "clinic-1",
      leadId: "lead-1",
      startsAt: new Date("2026-09-03T12:00:00.000Z"),
      endsAt: new Date("2026-09-03T13:00:00.000Z"),
      status: "pending",
      calendarEventId: null,
      expiresAt: new Date("2026-09-03T00:00:00.000Z"),
    }),
  };
  const adapter = createDentalJourneyLiveAdapter({
    clinicId: "clinic-1",
    conversationId: "conversation-1",
    turnId: "turn-1",
    now,
    inboundMessage: {
      id: "message-1",
      mediaType: flow === "photo" ? "image" : flow === "deposit" ? "document" : null,
      mediaUrl: flow === "start" ? null : "https://media.invalid/inbound",
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
    reservations,
    leadId: "lead-1",
    depositProofReviews: {
      nextAvailableCode: vi.fn().mockResolvedValue(7),
    },
    humanReviews: {
      findPendingByConversation: vi.fn().mockResolvedValue(null),
      createPending: vi.fn().mockResolvedValue({
        id: "review-1",
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        leadId: "lead-1",
        treatmentId: treatment.id,
        targetTreatmentId: treatment.id,
        reviewCode: 9,
        expiresAt: new Date("2026-09-03T12:00:00.000Z"),
      }),
    },
  } as never);
  return { adapter, state, reservations };
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

  it("binds a journey photo to the exact state and creates one human review", async () => {
    const { adapter, state } = harness("clinic-1", "photo");
    const resolution = await adapter.journeyRead.resolveInboundMedia();
    expect(resolution).toMatchObject({ kind: "ready", mediaKind: "journey_media" });
    if (resolution.kind !== "ready") throw new Error("expected photo resolution");

    await expect(adapter.journeyWrite.receiveMedia(resolution.resolutionId))
      .resolves.toMatchObject({ success: true, kind: "journey_media_received" });
    expect(state.markPipelinePhotoReceivedForTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        turnId: "turn-1",
        expectedCurrentStateId: "state-photo-1",
        expectedTreatmentId: treatment.id,
        expectedStepIndex: 1,
        sourceMessageId: "message-1",
      }),
    );
    expect(adapter.journeyWrite.takeDeliveryPlan()).toMatchObject({
      deterministic: true,
      postDeliveryControl: {
        kind: "handoff",
        reason: "v2_journey_photo_review_required",
      },
    });
  });

  it("records an exact deposit proof, extends its hold and requests Inbox attention", async () => {
    const { adapter, state } = harness("clinic-1", "deposit");
    const resolution = await adapter.journeyRead.resolveInboundMedia();
    expect(resolution).toMatchObject({ kind: "ready", mediaKind: "deposit_proof" });
    if (resolution.kind !== "ready") throw new Error("expected proof resolution");

    await expect(adapter.journeyWrite.receiveMedia(resolution.resolutionId))
      .resolves.toMatchObject({ success: true, kind: "deposit_proof_received" });
    expect(state.markDepositProofReceivedForTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        turnId: "turn-1",
        expectedCurrentStateId: "state-deposit-1",
        sourceMessageId: "message-1",
        proofReviewCode: 7,
      }),
    );
    expect(adapter.journeyWrite.takeDeliveryPlan()).toMatchObject({
      replyText: expect.stringMatching(/recebemos seu comprovante/i),
      postDeliveryControl: {
        kind: "attention",
        reason: "v2_deposit_proof_review_required",
      },
    });
  });

  it("releases only the exact pending deposit reservation before returning to scheduling", async () => {
    const { adapter, reservations, state } = harness("clinic-1", "deposit");

    await expect(adapter.journeyWrite.releasePendingDeposit()).resolves.toEqual({
      success: true,
      kind: "deposit_change_released",
      subjectId: "reservation-1",
      subjectLabel: "quinta às 09h",
      evidenceRef: "reservation:reservation-1:released",
    });
    expect(reservations.release).toHaveBeenCalledOnce();
    expect(reservations.release).toHaveBeenCalledWith("reservation-1");
    expect(state.invalidateIfCurrent).toHaveBeenCalledWith(
      "conversation-1",
      "state-deposit-1",
    );
  });

  it("never releases a reservation after its proof entered human review", async () => {
    const { adapter, reservations, state } = harness("clinic-1", "proof_received");

    await expect(adapter.journeyWrite.releasePendingDeposit()).resolves.toMatchObject({
      success: false,
      reason: "deposit_change_requires_human",
    });
    expect(reservations.release).not.toHaveBeenCalled();
    expect(state.invalidateIfCurrent).not.toHaveBeenCalled();
  });
});
