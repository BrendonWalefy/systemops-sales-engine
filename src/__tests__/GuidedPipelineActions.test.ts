import { describe, expect, it } from "vitest";
import {
  buildGuidedPipelineContentDraft,
  buildGuidedPipelinePackage,
  buildGuidedPipelineStepDraft,
  GUIDED_PIPELINE_ACTION_START_RAILS,
  listGuidedPipelineSections,
  summarizeGuidedPipelinePackage,
} from "@/application/conversations/guided-pipeline-actions";
import { nextActivePipelineStep } from "@/core/pipeline/ConversationOrchestrator";
import type { PipelineStep } from "@/domain/entities/treatment";

describe("GuidedPipelineActions", () => {
  it("builds the deterministic preview package until the first photo step", () => {
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

    const pkg = buildGuidedPipelinePackage(steps, GUIDED_PIPELINE_ACTION_START_RAILS);

    expect(pkg.resumeStepIndex).toBe(1);
    expect(pkg.parts).toEqual([
      { type: "text", content: "Temos duas tecnicas de lentes." },
      { type: "media", mediaId: "premium-card", caption: "Valores Premium" },
      { type: "media", mediaId: "estratificada-card", caption: undefined },
      { type: "text", content: "Pode me enviar uma foto do seu sorriso para o doutor avaliar?" },
    ]);
  });

  it("builds a first content draft with text and media ids for deterministic sending", () => {
    const step: Extract<PipelineStep, { type: "content" }> = {
      type: "content",
      label: "Valores",
      blocks: [
        { kind: "text", content: "Temos duas tecnicas de lentes." },
        { kind: "media", mediaId: "premium-card", caption: "Valores Premium" },
        { kind: "media", mediaId: "estratificada-card" },
      ],
    };

    expect(buildGuidedPipelineContentDraft(step)).toEqual({
      text: "Temos duas tecnicas de lentes.",
      mediaIds: ["premium-card", "estratificada-card"],
      parts: [
        { type: "text", content: "Temos duas tecnicas de lentes." },
        { type: "media", mediaId: "premium-card", caption: "Valores Premium" },
        { type: "media", mediaId: "estratificada-card", caption: undefined },
      ],
    });
  });

  it("builds a directly sendable draft for a selected photo step", () => {
    expect(
      buildGuidedPipelineStepDraft({
        type: "photo",
        label: "Aguardar foto",
        message: "Pode enviar a foto por aqui.",
        required: false,
      }),
    ).toEqual({
      text: "Pode enviar a foto por aqui.",
      mediaIds: [],
      parts: [{ type: "text", content: "Pode enviar a foto por aqui." }],
    });
  });

  it("lists every pipeline section and marks what the operator can do", () => {
    const sections = listGuidedPipelineSections([
      {
        type: "content",
        label: "Pedido de foto + exemplo",
        blocks: [
          { kind: "text", content: "Envie uma foto do sorriso." },
          { kind: "media", mediaId: "example" },
        ],
      },
      { type: "qa", label: "Dúvidas", instruction: "Responda dúvidas." },
      { type: "photo", label: "Aguardar foto", message: "Pode mandar aqui.", required: false },
      { type: "offer_slots", label: "Mostrar horários" },
    ]);

    expect(sections).toEqual([
      expect.objectContaining({ stepIndex: 0, stepNumber: 1, mode: "send", textParts: 1, mediaParts: 1 }),
      expect.objectContaining({ stepIndex: 1, stepNumber: 2, mode: "arm", preview: "Responda dúvidas." }),
      expect.objectContaining({ stepIndex: 2, stepNumber: 3, mode: "send", actionLabel: "Enviar pedido e aguardar foto" }),
      expect.objectContaining({ stepIndex: 3, stepNumber: 4, mode: "automatic", actionLabel: "Etapa automática" }),
    ]);
  });

  it("does not include scheduling steps in the preview", () => {
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
      action: GUIDED_PIPELINE_ACTION_START_RAILS,
      label: "Entrar no fluxo — IA conduz passo a passo",
      textParts: 2,
      mediaParts: 0,
      preview: "Primeira mensagem do pacote",
      willWaitForPhoto: true,
    });
  });

  // A ação arma o trilho em vez de despejar o pacote: o posicionamento usa
  // nextActivePipelineStep com o histórico, garantindo que conteúdo já enviado
  // manualmente pela operação não será repetido pelo motor.
  describe("posicionamento do trilho (start_pipeline_rails)", () => {
    const steps: PipelineStep[] = [
      {
        type: "content",
        label: "Apresentacao",
        blocks: [{ kind: "text", content: "Temos duas tecnicas de lentes de resina composta." }],
      },
      { type: "photo", label: "Foto", message: "Pode me enviar uma foto do seu sorriso?", required: true },
      { type: "offer_slots", label: "Ofertar agenda" },
    ];

    it("conversa nova posiciona no passo de conteúdo", () => {
      const active = nextActivePipelineStep(steps, 0, { conversationHistory: [] });
      expect(active?.index).toBe(0);
      expect(active?.step.type).toBe("content");
    });

    it("conteúdo já enviado pela operação posiciona no pedido de foto", () => {
      const active = nextActivePipelineStep(steps, 0, {
        conversationHistory: [
          { author: "clinic_user", body: "Temos duas tecnicas de lentes de resina composta." },
        ],
      });
      expect(active?.index).toBe(1);
      expect(active?.step.type).toBe("photo");
    });
  });
});
