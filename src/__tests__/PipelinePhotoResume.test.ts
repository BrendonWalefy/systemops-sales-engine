// Pipeline photo intercept: when a lead sends a photo while the pipeline is waiting
// on a "photo" step, the AI must resume automatically (no human takeover).
// When photo arrives outside a pipeline context, existing pause + takeover applies.

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

function shouldResumePipeline(
  inboundMediaType: string,
  pipelineState: PipelineState | null,
  treatments: Treatment[],
): boolean {
  if (inboundMediaType !== "image" && inboundMediaType !== "video") return false;
  if (!pipelineState) return false;
  const treatment = treatments.find(t => t.id === pipelineState.treatmentId);
  const currentStep = treatment?.pipelineSteps?.[pipelineState.stepIndex];
  return currentStep?.type === "photo";
}

function nextStepAfterPhoto(
  pipelineState: PipelineState,
  treatments: Treatment[],
): { index: number; type: string } | null {
  const treatment = treatments.find(t => t.id === pipelineState.treatmentId);
  const steps = treatment?.pipelineSteps ?? [];
  for (let i = pipelineState.stepIndex + 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.type === "content" || s.type === "qa" || s.type === "photo" || s.type === "ask_availability" || s.type === "offer_slots" || s.type === "book") {
      return { index: i, type: s.type };
    }
  }
  return null;
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

describe("Pipeline photo intercept — decisão de retomada automática", () => {
  it("retoma pipeline quando foto chega e step atual é 'photo'", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    expect(shouldResumePipeline("image", state, [TREATMENT])).toBe(true);
  });

  it("retoma pipeline quando vídeo chega e step atual é 'photo'", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    expect(shouldResumePipeline("video", state, [TREATMENT])).toBe(true);
  });

  it("NÃO retoma se mídia é documento", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    expect(shouldResumePipeline("document", state, [TREATMENT])).toBe(false);
  });

  it("NÃO retoma se não há pipeline ativo", () => {
    expect(shouldResumePipeline("image", null, [TREATMENT])).toBe(false);
  });

  it("NÃO retoma se step atual não é 'photo' (está em Q&A)", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 1, photoReceived: false };
    expect(shouldResumePipeline("image", state, [TREATMENT])).toBe(false);
  });

  it("NÃO retoma se treatment não encontrado", () => {
    const state: PipelineState = { treatmentId: "treatment-outro", stepIndex: 2, photoReceived: false };
    expect(shouldResumePipeline("image", state, [TREATMENT])).toBe(false);
  });

  it("NÃO retoma se treatment não tem pipelineSteps", () => {
    const treatment: Treatment = { id: "treatment-lentes", pipelineSteps: null };
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    expect(shouldResumePipeline("image", state, [treatment])).toBe(false);
  });
});

describe("Pipeline photo intercept — próximo step após foto", () => {
  it("avança para ask_availability (index 3) após o step photo (index 2)", () => {
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 2, photoReceived: false };
    const next = nextStepAfterPhoto(state, [TREATMENT]);
    expect(next).toEqual({ index: 3, type: "ask_availability" });
  });

  it("retorna null se foto é o último step — pipeline encerra", () => {
    const steps: PipelineStep[] = [
      { type: "content", label: "Conteúdo", blocks: [] },
      { type: "photo", label: "Foto", message: "Mande uma foto.", required: false },
    ];
    const treatment: Treatment = { id: "treatment-lentes", pipelineSteps: steps };
    const state: PipelineState = { treatmentId: "treatment-lentes", stepIndex: 1, photoReceived: false };
    expect(nextStepAfterPhoto(state, [treatment])).toBeNull();
  });
});
