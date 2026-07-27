import { describe, expect, it } from "vitest";
import {
  matchesPipelineAdvanceExpectation,
  type TreatmentPipelinePayload,
} from "@/core/conversation/ConversationStateMachine";

const current: TreatmentPipelinePayload = {
  treatmentId: "canonical-lenses",
  treatmentName: "Lentes",
  selectedTreatmentId: "stratified-lenses",
  selectedTreatmentName: "Estratificada",
  stepIndex: 0,
  qaTurns: 0,
  photoReceived: false,
};

describe("pipeline turn commit", () => {
  it("consome somente a revisão esperada do tratamento canônico", () => {
    expect(
      matchesPipelineAdvanceExpectation(current, {
        treatmentId: "canonical-lenses",
        stepIndex: 0,
      }),
    ).toBe(true);
  });

  it("retry do sender não avança novamente uma revisão já consumida", () => {
    const afterCommit = { ...current, stepIndex: 1 };
    expect(
      matchesPipelineAdvanceExpectation(afterCommit, {
        treatmentId: "canonical-lenses",
        stepIndex: 0,
      }),
    ).toBe(false);
  });

  it("não aplica avanço pertencente a outro tratamento", () => {
    expect(
      matchesPipelineAdvanceExpectation(current, {
        treatmentId: "another-treatment",
        stepIndex: 0,
      }),
    ).toBe(false);
  });

  it("mantém compatibilidade com payload legado sem expectativa", () => {
    expect(matchesPipelineAdvanceExpectation(current)).toBe(true);
  });
});
