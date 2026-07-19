import { describe, expect, it } from "vitest";
import {
  canAppendQaFollowUpContent,
  isRemotePreEvaluationRequest,
} from "@/core/pipeline/ConversationOrchestrator";

describe("pré-avaliação remota — rota determinística para o bloco de foto", () => {
  it.each([
    "Quero saber os valores e fazer uma avaliação por aqui",
    "O Doutor consegue fazer uma pré-avaliação aqui mesmo?",
    "Dá para analisar pelo WhatsApp?",
    "Posso mandar uma foto para o Doutor avaliar?",
    "Vocês conseguem avaliar pelas fotos?",
  ])("detecta sinal explícito de avaliação remota: %s", (message) => {
    expect(isRemotePreEvaluationRequest(message)).toBe(true);
  });

  it.each([
    "Quero fazer uma avaliação",
    "Qual é o valor da avaliação?",
    "Quero agendar uma avaliação presencial",
    "Me mostra as cores",
    "Tenho dúvidas sobre o procedimento",
  ])("não confunde avaliação presencial ou descoberta com pré-análise remota: %s", (message) => {
    expect(isRemotePreEvaluationRequest(message)).toBe(false);
  });

  it("libera o próximo conteúdo de foto durante o Q&A quando o lead pede avaliação por aqui", () => {
    expect(
      canAppendQaFollowUpContent({
        nextContentIsPhotoInstruction: true,
        keywordMediaMatched: false,
        leadMessage: "Quero fazer uma pré-avaliação por aqui",
      }),
    ).toBe(true);
  });

  it("mantém o freio de J8 para dúvidas exploratórias", () => {
    expect(
      canAppendQaFollowUpContent({
        nextContentIsPhotoInstruction: true,
        keywordMediaMatched: true,
        leadMessage: "Me mostra as cores",
      }),
    ).toBe(false);
  });
});
