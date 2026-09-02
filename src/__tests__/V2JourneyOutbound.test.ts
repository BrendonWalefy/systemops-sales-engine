import { describe, expect, it } from "vitest";
import { resolveJourneyOutboundContent } from "@/application/conversation-v2/v2-live-conversation-handler";
import { isConversationOutboundPayload } from "@/application/jobs/conversation-outbound-payload";
import {
  canCommitPipelineAdvance,
  resolvePostDeliveryConversationControl,
} from "@/application/jobs/send-message-job";

describe("V2 journey outbound", () => {
  it("uses one configured ordered plan without voice or inferred text", () => {
    const result = resolveJourneyOutboundContent({
      replyText: "Primeiro texto.\n\nDepois do vídeo.",
      interleavedParts: [
        { type: "text", content: "Primeiro texto." },
        {
          type: "media",
          mediaId: "media-1",
          url: "https://media.invalid/video.mp4",
          mediaType: "video",
          title: "Vídeo",
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
    }, { text: "Texto inferido que não pode sair.", useVoice: true });

    expect(result).toEqual({
      replyText: "Primeiro texto.\n\nDepois do vídeo.",
      useVoice: false,
      interleavedParts: [
        { type: "text", content: "Primeiro texto." },
        {
          type: "media",
          mediaId: "media-1",
          url: "https://media.invalid/video.mp4",
          mediaType: "video",
          title: "Vídeo",
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
      postDeliveryControl: null,
    });
  });

  it("leaves ordinary V2 responses unchanged", () => {
    expect(resolveJourneyOutboundContent(null, {
      text: "Resposta comum.",
      useVoice: true,
    })).toEqual({
      replyText: "Resposta comum.",
      useVoice: true,
      interleavedParts: [],
      pipelineAdvance: null,
      postDeliveryControl: null,
    });
  });

  it("commits the exact pipeline revision only after complete media delivery", () => {
    expect(canCommitPipelineAdvance([
      { mediaAttempted: 1, mediaSent: 1, mediaFailed: 0 },
    ])).toBe(true);
    expect(canCommitPipelineAdvance([
      { mediaAttempted: 1, mediaSent: 0, mediaFailed: 1 },
    ])).toBe(false);
  });

  it("applies review control only after delivery and distinguishes attention from handoff", () => {
    const base = {
      version: 1 as const,
      kind: "conversation_reply" as const,
      to: "destination",
      agentMessageId: "agent-1",
      replyText: "Recebido.",
      intent: null,
      useVoice: false,
      ttsConfig: { provider: "nova" as const, speed: 1 },
      interleavedParts: [],
      mediaParts: [],
      leadId: "lead-1",
      pipelineAdvance: null,
    };
    expect(resolvePostDeliveryConversationControl({
      ...base,
      postDeliveryControl: {
        kind: "attention",
        reason: "v2_deposit_proof_review_required",
      },
    })).toEqual({
      pauseAutomation: false,
      reason: "v2_deposit_proof_review_required",
    });
    expect(resolvePostDeliveryConversationControl({
      ...base,
      postDeliveryControl: {
        kind: "handoff",
        reason: "v2_journey_photo_review_required",
      },
    })).toEqual({
      pauseAutomation: true,
      reason: "v2_journey_photo_review_required",
    });
  });

  it("rejects unknown persisted post-delivery control fields", () => {
    expect(isConversationOutboundPayload({
      version: 1,
      kind: "conversation_reply",
      to: "destination",
      agentMessageId: "agent-1",
      replyText: "Recebido.",
      intent: null,
      useVoice: false,
      ttsConfig: { provider: "nova", speed: 1 },
      interleavedParts: [],
      mediaParts: [],
      leadId: "lead-1",
      pipelineAdvance: null,
      postDeliveryControl: {
        kind: "attention",
        reason: "v2_deposit_proof_review_required",
        unsafeOverride: true,
      },
    })).toBe(false);
  });
});
