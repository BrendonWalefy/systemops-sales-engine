// Pipeline photo intercept: when a lead sends a photo or video while the pipeline
// is waiting on a "photo" step, or still in Q&A with a photo step ahead, the
// system creates a human review case without forcing a manual takeover.

import { describe, it, expect } from "vitest";
import type { PipelineStep } from "@/domain/entities/treatment";

// ─── Pure model of the intercept decision ─────────────────────────────────────

type PipelineState = {
  treatmentId: string;
  stepIndex: number;
  photoReceived: boolean;
};

type Treatment = {
  id: string;
  pipelineSteps: PipelineStep[] | null;
};

function shouldCreateHumanReview(
  inboundMediaType: string,
  pipelineState: PipelineState | null,
  treatments: Treatment[],
): boolean {
  if (inboundMediaType !== "image" && inboundMediaType !== "video") return false;
  if (!pipelineState) return false;
  const treatment = treatments.find(t => t.id === pipelineState.treatmentId);
  const currentStep = treatment?.pipelineSteps?.[pipelineState.stepIndex];
  const hasPhotoStepAhead = treatment?.pipelineSteps?.some(
    (step, idx) => idx > pipelineState.stepIndex && step.type === "photo",
  ) ?? false;
  return currentStep?.type === "photo" || (currentStep?.type === "qa" && hasPhotoStepAhead);
}

function shouldPauseAiForPipelinePhotoReview(conversationAlreadyPaused: boolean): boolean {
  return conversationAlreadyPaused;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LENTES_PIPELINE: PipelineStep[] = [
  { type: "content", label: "Apresentar técnicas", blocks: [] },
  { type: "qa", label: "Tirar dúvidas", maxTurns: 10 },
  { type: "photo", label: "Convidar foto", message: "Se quiser, mande uma foto.", required: false },
  { type: "ask_availability", label: "Perguntar disponibilidade" },
  { type: "offer_slots", label: "Mostrar horários" },
  { type: "book", label: "Confirmar agendamento" },
];

const TREATMENT: Treatment = { id: "treatment-lentes", pipelineSteps: LENTES_PIPELINE };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Pipeline photo intercept — revisão humana determinística", () => {
  it("cria revisão humana quando foto chega e step atual é 'photo'", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    expect(shouldCreateHumanReview("image", state, [TREATMENT])).toBe(true);
  });

  it("cria revisão humana quando vídeo chega e step atual é 'photo'", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    expect(shouldCreateHumanReview("video", state, [TREATMENT])).toBe(true);
  });

  it("NÃO cria revisão se mídia é documento", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    expect(shouldCreateHumanReview("document", state, [TREATMENT])).toBe(false);
  });

  it("NÃO cria revisão se não há pipeline ativo", () => {
    expect(shouldCreateHumanReview("image", null, [TREATMENT])).toBe(false);
  });

  it("cria revisão se está em Q&A com step de foto adiante", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 1, photoReceived: false };
    expect(shouldCreateHumanReview("image", state, [TREATMENT])).toBe(true);
  });

  it("NÃO cria revisão se treatment não encontrado", () => {
    const state: PipelineState = { treatmentId: "treatment-outro", stepIndex: 2, photoReceived: false };
    expect(shouldCreateHumanReview("image", state, [TREATMENT])).toBe(false);
  });

  it("NÃO cria revisão se treatment não tem pipelineSteps", () => {
    const treatment: Treatment = { id: "treatment-lentes", pipelineSteps: null };
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    expect(shouldCreateHumanReview("image", state, [treatment])).toBe(false);
  });

  it("não pausa IA por padrão quando a foto pertence ao pipeline ativo", () => {
    expect(shouldPauseAiForPipelinePhotoReview(false)).toBe(false);
    expect(shouldPauseAiForPipelinePhotoReview(true)).toBe(true);
  });
});
