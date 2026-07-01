import { describe, expect, it } from "vitest";
import { shouldUseBWaveForMessage } from "@/domain/entities/voice-mode";

describe("shouldUseBWaveForMessage — greeting_only (teaser do plano Start)", () => {
  const longText = "Oi! Tudo bem? Seja muito bem-vinda à nossa clínica, como posso ajudar?";

  it("usa voz na saudação", () => {
    expect(shouldUseBWaveForMessage("greeting_only", "greeting", longText, false)).toBe(true);
  });

  it("não usa voz em outros intents, mesmo de alto impacto", () => {
    expect(shouldUseBWaveForMessage("greeting_only", "book_appointment", longText, false)).toBe(false);
    expect(shouldUseBWaveForMessage("greeting_only", "price_inquiry", longText, false)).toBe(false);
  });

  it("mantém a simetria: lead mandou áudio, resposta vem em áudio mesmo fora da saudação", () => {
    expect(shouldUseBWaveForMessage("greeting_only", "check_availability", longText, true)).toBe(true);
  });

  it("respostas curtas não geram áudio nem na saudação", () => {
    expect(shouldUseBWaveForMessage("greeting_only", "greeting", "Oi!", false)).toBe(false);
  });
});
