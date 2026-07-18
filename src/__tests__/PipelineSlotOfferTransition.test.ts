import { describe, expect, it } from "vitest";
import { shouldOfferSlotsAfterPipelinePhoto } from "@/core/pipeline/ConversationOrchestrator";

describe("Pipeline — transição para oferta de slots", () => {
  it("oferta agenda quando a foto foi recebida e o pipeline está no step photo", () => {
    expect(shouldOfferSlotsAfterPipelinePhoto("photo", true)).toBe(true);
  });

  it("oferta agenda quando o pipeline já está no step ask_availability", () => {
    expect(shouldOfferSlotsAfterPipelinePhoto("ask_availability", false)).toBe(true);
  });

  it("não oferta agenda antes da foto ser recebida", () => {
    expect(shouldOfferSlotsAfterPipelinePhoto("photo", false)).toBe(false);
  });

  it("não troca o Q&A por agenda só porque o lead reconheceu a mensagem", () => {
    expect(shouldOfferSlotsAfterPipelinePhoto("qa", false)).toBe(false);
  });
});
