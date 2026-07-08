import { describe, expect, it } from "vitest";
import { computeMediaGapWarning } from "@/app/(clinic)/app/settings/pipeline/[treatmentId]/pipeline-editor-client";
import type { PipelineStep } from "@/domain/entities/treatment";

const TREATMENT_ID = "39b29140-f356-4a0c-aa36-be533aa58c8e"; // Lentes em Resina Composta (Vitalli)
const VIDEO_ID = "0c771e1b-a1e2-45cb-8a3d-ecbd0b2f0c7c"; // Resultado Técnica Estratificada

const contentStepWithoutMedia: PipelineStep = {
  type: "content",
  label: "Apresentar técnicas de lentes",
  blocks: [
    { kind: "text", content: "Nós somos especialistas em lentes de resina composta..." },
    { kind: "text", content: "A Técnica Simplificada é feita com resina de altíssima qualidade..." },
    { kind: "text", content: "Já a Técnica Estratificada é feita com resina premium em várias camadas..." },
  ],
};

const qaStep: PipelineStep = { type: "qa", label: "Tirar dúvidas", maxTurns: 10 };

describe("computeMediaGapWarning", () => {
  it("acende o aviso — caso real Vitalli antes do fix: mídia própria existe, mas nenhum step de conteúdo a usa", () => {
    const mediaLibrary = [
      { id: VIDEO_ID, treatmentId: TREATMENT_ID },
      { id: "img-1", treatmentId: TREATMENT_ID },
    ];
    const result = computeMediaGapWarning([contentStepWithoutMedia, qaStep], mediaLibrary, TREATMENT_ID);
    expect(result.show).toBe(true);
    expect(result.contentStepIndexes).toEqual([0]);
    expect(result.treatmentSpecificMediaCount).toBe(2);
  });

  it("não acende — depois do fix: o vídeo já está referenciado em um bloco de mídia", () => {
    const contentStepWithVideo: PipelineStep = {
      ...contentStepWithoutMedia,
      blocks: [...contentStepWithoutMedia.blocks, { kind: "media", mediaId: VIDEO_ID }],
    };
    const mediaLibrary = [{ id: VIDEO_ID, treatmentId: TREATMENT_ID }];
    const result = computeMediaGapWarning([contentStepWithVideo, qaStep], mediaLibrary, TREATMENT_ID);
    expect(result.show).toBe(false);
  });

  it("não acende — mídia geral (treatmentId null) não conta, evita ruído", () => {
    const mediaLibrary = [{ id: "foto-exemplo", treatmentId: null }];
    const result = computeMediaGapWarning([contentStepWithoutMedia], mediaLibrary, TREATMENT_ID);
    expect(result.show).toBe(false);
  });

  it("não acende — tratamento sem step de conteúdo (só qa/photo/marcadores)", () => {
    const mediaLibrary = [{ id: VIDEO_ID, treatmentId: TREATMENT_ID }];
    const result = computeMediaGapWarning([qaStep], mediaLibrary, TREATMENT_ID);
    expect(result.show).toBe(false);
    expect(result.contentStepIndexes).toEqual([]);
  });

  it("não acende — tratamento sem nenhuma mídia própria cadastrada", () => {
    const result = computeMediaGapWarning([contentStepWithoutMedia], [], TREATMENT_ID);
    expect(result.show).toBe(false);
  });

  it("não acende — cobertura parcial já conta como usado (pelo menos uma mídia própria referenciada)", () => {
    const contentStepWithVideo: PipelineStep = {
      ...contentStepWithoutMedia,
      blocks: [...contentStepWithoutMedia.blocks, { kind: "media", mediaId: VIDEO_ID }],
    };
    const mediaLibrary = [
      { id: VIDEO_ID, treatmentId: TREATMENT_ID },
      { id: "img-nao-referenciada", treatmentId: TREATMENT_ID },
    ];
    const result = computeMediaGapWarning([contentStepWithVideo], mediaLibrary, TREATMENT_ID);
    expect(result.show).toBe(false);
  });
});
