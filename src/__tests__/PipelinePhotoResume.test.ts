import { describe, expect, it } from "vitest";
import {
  matchesHumanReviewPipelineContext,
  resolvePipelineMediaRoute,
} from "@/core/pipeline/PipelineMediaRouter";
import type { Treatment } from "@/domain/entities/treatment";

const pipeline = {
  id: "pipeline-lentes",
  name: "Lentes",
  pipelineSourceTreatmentId: null,
  pipelineSteps: [
    { type: "content", label: "Apresentar", blocks: [] },
    { type: "qa", label: "Dúvidas", maxTurns: 10 },
    { type: "photo", label: "Foto", message: "Envie uma foto", required: false },
    { type: "ask_availability", label: "Disponibilidade" },
  ],
} as Treatment;
const variation = {
  ...pipeline,
  id: "lentes-estratificadas",
  name: "Lentes Estratificadas",
  pipelineSteps: null,
  pipelineSourceTreatmentId: pipeline.id,
} as Treatment;

describe("PipelineMediaRouter", () => {
  it("vincula a foto à variação escolhida, preservando o pipeline pai", () => {
    const route = resolvePipelineMediaRoute({
      mediaType: "image",
      state: {
        treatmentId: pipeline.id,
        treatmentName: pipeline.name,
        selectedTreatmentId: variation.id,
        selectedTreatmentName: variation.name,
        stepIndex: 2,
        qaTurns: 0,
        photoReceived: false,
      },
      treatments: [pipeline, variation],
    });
    expect(route).toMatchObject({
      kind: "human_review",
      pipelineTreatment: { id: pipeline.id },
      targetTreatment: { id: variation.id },
      sourceStepType: "photo",
    });
  });

  it("aceita foto ainda no Q&A quando há etapa de foto adiante", () => {
    const route = resolvePipelineMediaRoute({
      mediaType: "video",
      state: {
        treatmentId: pipeline.id,
        treatmentName: pipeline.name,
        stepIndex: 1,
        qaTurns: 2,
        photoReceived: false,
      },
      treatments: [pipeline],
    });
    expect(route).toMatchObject({ kind: "human_review", sourceStepType: "qa" });
  });

  it("não deixa mídia ou estado incompatível escolher tratamento errado", () => {
    expect(resolvePipelineMediaRoute({
      mediaType: "document",
      state: null,
      treatments: [pipeline],
    })).toEqual({ kind: "outside_pipeline" });

    const unrelated = {
      ...variation,
      id: "outro",
      pipelineSourceTreatmentId: "pipeline-outro",
    } as Treatment;
    expect(resolvePipelineMediaRoute({
      mediaType: "image",
      state: {
        treatmentId: pipeline.id,
        treatmentName: pipeline.name,
        selectedTreatmentId: unrelated.id,
        selectedTreatmentName: unrelated.name,
        stepIndex: 2,
        qaTurns: 0,
        photoReceived: false,
      },
      treatments: [pipeline, unrelated],
    })).toEqual({
      kind: "invalid_pipeline_target",
      reason: "selected_treatment_does_not_belong_to_pipeline_family",
    });
  });

  it("só retoma uma revisão que ainda corresponde ao pipeline e à variação", () => {
    const state = {
      treatmentId: pipeline.id,
      treatmentName: pipeline.name,
      selectedTreatmentId: variation.id,
      selectedTreatmentName: variation.name,
      stepIndex: 2,
      qaTurns: 0,
      photoReceived: true,
    };
    expect(matchesHumanReviewPipelineContext({
      state,
      pipelineTreatmentId: pipeline.id,
      targetTreatmentId: variation.id,
    })).toBe(true);
    expect(matchesHumanReviewPipelineContext({
      state,
      pipelineTreatmentId: pipeline.id,
      targetTreatmentId: "outra-variacao",
    })).toBe(false);
  });
});
