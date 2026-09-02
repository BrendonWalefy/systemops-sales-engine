import { describe, expect, it } from "vitest";
import { resolveJourneyOutboundContent } from "@/application/conversation-v2/v2-live-conversation-handler";
import { canCommitPipelineAdvance } from "@/application/jobs/send-message-job";

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
});
