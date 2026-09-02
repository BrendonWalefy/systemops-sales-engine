import { describe, expect, it, vi } from "vitest";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import { createDentalJourneyCapability } from "@/domain-packs/dental/journey-capability";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const state = {
  phase: "idle",
  pendingStepId: null,
  completedStepIds: [],
};
const context = {
  state,
  policy: {
    priceDisclosureEnabled: true,
    humanEscalationRequired: false,
    schedulingMinimumLeadTimeHours: 2,
    schedulingRequiresEvaluationFirst: false,
  },
  now: new Date("2026-09-02T00:00:00.000Z"),
};

function understanding(
  request: DentalRequest,
  service: string | null = null,
): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request,
    dialogueMove: "new_topic",
    entities: {
      service,
      businessInformationTopic: null,
      date: null,
      period: null,
      time: null,
      professional: null,
      serviceCandidates: null,
      faqQuestion: null,
      quantity: null,
      quantityScope: null,
      objectionQuestion: null,
      ordinal: null,
    },
    signals: {
      purchaseIntent: null,
      priceSensitivity: null,
      sentiment: null,
      objection: null,
    },
    safety: { optOut: false, requestsHuman: false, emergency: false },
    confidence: 1,
    ambiguity: null,
  };
}

describe("dental journey capability", () => {
  it("binds an exact configured journey step from decision through receipt", async () => {
    const prepareStep = vi.fn().mockResolvedValue({
      success: true,
      kind: "journey_step_ready",
      subjectId: "treatment-1:step-0",
      subjectLabel: "Como funciona",
      evidenceRef: "conversation-state:state-1",
    });
    const capability = createDentalJourneyCapability({
      resolveStart: vi.fn().mockResolvedValue({
        kind: "ready",
        resolutionId: "journey:start:treatment-1:0",
        subjectId: "treatment-1:step-0",
        subjectLabel: "Como funciona",
        evidenceRef: "treatment:treatment-1:pipeline:0",
      }),
      resolveCurrentStep: vi.fn(),
      resolveInboundMedia: vi.fn(),
    } as never, {
      prepareStep,
      receiveMedia: vi.fn(),
      releasePendingDeposit: vi.fn(),
      takeDeliveryPlan: vi.fn(),
    } as never);

    const claim = capability.claim(understanding("start-treatment-journey", "Clareamento"), state);
    expect(claim?.payload).toEqual({
      kind: "journey",
      request: "start-treatment-journey",
      serviceQuery: "Clareamento",
    });
    const decision = await capability.decide(claim!, context);
    expect(decision).toEqual({
      kind: "execute",
      action: {
        type: "prepare-journey-step",
        parameters: { resolutionId: "journey:start:treatment-1:0" },
      },
      nextBestStep: null,
    });

    const result = await capability.execute(decision, context);
    expect(prepareStep).toHaveBeenCalledWith("journey:start:treatment-1:0");
    expect(result).toMatchObject({
      type: "journey_step_ready",
      semanticClass: "information_authorized",
      origin: { capabilityId: "dental-journey" },
      subject: { id: "treatment-1:step-0", displayName: "Como funciona" },
    });
  });

  it("uses the trusted media resolution to receive a deposit proof", async () => {
    const receiveMedia = vi.fn().mockResolvedValue({
      success: true,
      kind: "deposit_proof_received",
      subjectId: "deposit-state-1",
      subjectLabel: "Comprovante do sinal",
      evidenceRef: "conversation-state:proof-state-1",
    });
    const capability = createDentalJourneyCapability({
      resolveStart: vi.fn(),
      resolveCurrentStep: vi.fn(),
      resolveInboundMedia: vi.fn().mockResolvedValue({
        kind: "ready",
        mediaKind: "deposit_proof",
        resolutionId: "deposit-proof:message-1",
        subjectId: "deposit-state-1",
        subjectLabel: "Comprovante do sinal",
        evidenceRef: "message:message-1",
      }),
    } as never, {
      prepareStep: vi.fn(),
      receiveMedia,
      releasePendingDeposit: vi.fn(),
      takeDeliveryPlan: vi.fn(),
    } as never);

    const claim = capability.claim(understanding("submit-deposit-proof"), state)!;
    const decision = await capability.decide(claim, context);
    const result = await capability.execute(decision, context);

    expect(receiveMedia).toHaveBeenCalledWith("deposit-proof:message-1");
    expect(result).toMatchObject({
      type: "deposit_proof_received",
      semanticClass: "effect_completed",
      evidence: [{ source: "write", reference: "conversation-state:proof-state-1" }],
    });
  });

  it("asks instead of writing when no configured journey can be resolved", async () => {
    const prepareStep = vi.fn();
    const capability = createDentalJourneyCapability({
      resolveStart: vi.fn().mockResolvedValue({
        kind: "unavailable",
        reason: "journey_not_configured",
      }),
      resolveCurrentStep: vi.fn(),
      resolveInboundMedia: vi.fn(),
    } as never, {
      prepareStep,
      receiveMedia: vi.fn(),
      releasePendingDeposit: vi.fn(),
      takeDeliveryPlan: vi.fn(),
    } as never);

    const claim = capability.claim(understanding("start-treatment-journey", "Clareamento"), state)!;
    const decision = await capability.decide(claim, context);
    const result = await capability.execute(decision, context);

    expect(decision).toEqual({ kind: "ask", questionId: "journey_not_configured" });
    expect(result.type).toBe("clarification_required");
    expect(prepareStep).not.toHaveBeenCalled();
  });
});
