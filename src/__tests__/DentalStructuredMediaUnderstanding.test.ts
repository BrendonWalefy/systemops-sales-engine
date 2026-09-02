import { describe, expect, it } from "vitest";
import { resolveDentalStructuredMediaUnderstanding } from "@/application/conversation-v2/dental-structured-media-understanding";
import type { ConversationStateRow } from "@/core/conversation/ConversationStateMachine";

const state = (value: ConversationStateRow["state"]): ConversationStateRow => ({
  id: `state-${value}`,
  conversationId: "conversation-1",
  state: value,
  payload: value === "treatment_pipeline_active"
    ? {
        treatmentId: "treatment-1",
        treatmentName: "Lentes",
        stepIndex: 2,
        qaTurns: 0,
        photoReceived: false,
      }
    : null,
  supersedesStateId: null,
  createdAt: new Date("2026-09-02T00:00:00.000Z"),
  expiresAt: new Date("2026-09-03T00:00:00.000Z"),
});

describe("structured dental media understanding", () => {
  it("routes an image in a pending deposit from trusted metadata", () => {
    const result = resolveDentalStructuredMediaUnderstanding({
      mediaType: "image",
      state: state("awaiting_deposit_proof"),
    });

    expect(result).toMatchObject({
      version: "understanding.v1",
      request: "submit-deposit-proof",
      dialogueMove: "answers_pending",
      confidence: 1,
      safety: { optOut: false, requestsHuman: false, emergency: false },
    });
  });

  it("routes an image or video only when a treatment journey is active", () => {
    expect(resolveDentalStructuredMediaUnderstanding({
      mediaType: "video",
      state: state("treatment_pipeline_active"),
    })?.request).toBe("submit-journey-media");

    expect(resolveDentalStructuredMediaUnderstanding({
      mediaType: "image",
      state: null,
    })).toBeNull();
  });

  it("does not infer a proof from unsupported media", () => {
    expect(resolveDentalStructuredMediaUnderstanding({
      mediaType: "audio",
      state: state("awaiting_deposit_proof"),
    })).toBeNull();
    expect(resolveDentalStructuredMediaUnderstanding({
      mediaType: "video",
      state: state("awaiting_deposit_proof"),
    })).toBeNull();
  });
});
