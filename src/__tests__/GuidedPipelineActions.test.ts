import { describe, expect, it } from "vitest";
import {
  buildGuidedPipelinePackage,
  GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO,
  summarizeGuidedPipelinePackage,
} from "@/application/conversations/guided-pipeline-actions";
import type { PipelineStep } from "@/domain/entities/treatment";

describe("GuidedPipelineActions", () => {
  it("builds the deterministic intro package until the first photo step", () => {
    const steps: PipelineStep[] = [
      {
        type: "content",
        label: "Valores",
        blocks: [
          { kind: "text", content: "Temos duas tecnicas de lentes." },
          { kind: "media", mediaId: "premium-card", caption: "Valores Premium" },
          { kind: "media", mediaId: "estratificada-card" },
        ],
      },
      {
        type: "photo",
        label: "Foto do sorriso",
        message: "Pode me enviar uma foto do seu sorriso para o doutor avaliar?",
        required: true,
      },
      { type: "offer_slots", label: "Ofertar agenda" },
    ];

    const pkg = buildGuidedPipelinePackage(steps, GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO);

    expect(pkg.resumeStepIndex).toBe(1);
    expect(pkg.parts).toEqual([
      { type: "text", content: "Temos duas tecnicas de lentes." },
      { type: "media", mediaId: "premium-card", caption: "Valores Premium" },
      { type: "media", mediaId: "estratificada-card", caption: undefined },
      { type: "text", content: "Pode me enviar uma foto do seu sorriso para o doutor avaliar?" },
    ]);
  });

  it("does not include scheduling steps in the quick action", () => {
    const steps: PipelineStep[] = [
      { type: "content", label: "Intro", blocks: [{ kind: "text", content: "Intro" }] },
      { type: "ask_availability", label: "Perguntar disponibilidade" },
      { type: "offer_slots", label: "Ofertar slots" },
      { type: "book", label: "Agendar" },
    ];

    const pkg = buildGuidedPipelinePackage(steps);

    expect(pkg.resumeStepIndex).toBeNull();
    expect(pkg.parts).toEqual([{ type: "text", content: "Intro" }]);
  });

  it("summarizes counts and photo wait state for the inbox UI", () => {
    const pkg = buildGuidedPipelinePackage([
      { type: "content", label: "Intro", blocks: [{ kind: "text", content: "Primeira mensagem do pacote" }] },
      { type: "photo", label: "Foto", message: "Envie a foto, por favor.", required: true },
    ]);

    expect(summarizeGuidedPipelinePackage(pkg)).toEqual({
      action: GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO,
      label: "Apresentacao + pedido de foto",
      textParts: 2,
      mediaParts: 0,
      preview: "Primeira mensagem do pacote",
      willWaitForPhoto: true,
    });
  });
});
