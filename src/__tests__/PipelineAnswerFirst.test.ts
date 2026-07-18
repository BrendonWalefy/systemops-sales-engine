import { describe, expect, it } from "vitest";
import {
  buildAnswerFirstPipelineContent,
  findPipelineTreatmentContextForPriceRequest,
  hasPipelineContentStepBeenSent,
} from "@/core/pipeline/ConversationOrchestrator";
import type { PipelineStep, Treatment } from "@/domain/entities/treatment";
import type { ResponsePart } from "@/core/intelligence/ResponseComposer";

describe("Pipeline v2 Fase 1 — answer-first + once", () => {
  const contentStep: Extract<PipelineStep, { type: "content" }> = {
    type: "content",
    label: "Apresentação",
    blocks: [
      { kind: "text", content: "As lentes em resina têm duas técnicas principais." },
      { kind: "media", mediaId: "video-tecnicas", caption: "Veja as técnicas" },
      { kind: "text", content: "A escolha depende do seu objetivo estético." },
    ],
  };

  it("mantém a resposta do lead antes dos blocos de content no mesmo turno", () => {
    const answerParts: ResponsePart[] = [
      { type: "text", content: "A Premium é a opção com acabamento mais personalizado." },
    ];

    const result = buildAnswerFirstPipelineContent({
      answerText: "A Premium é a opção com acabamento mais personalizado.",
      answerParts,
      contentBlocks: contentStep.blocks,
    });

    expect(result.replyText).toBe(
      [
        "A Premium é a opção com acabamento mais personalizado.",
        "As lentes em resina têm duas técnicas principais.",
        "A escolha depende do seu objetivo estético.",
      ].join("\n\n"),
    );
    expect(result.parts).toEqual([
      { type: "text", content: "A Premium é a opção com acabamento mais personalizado." },
      { type: "text", content: "As lentes em resina têm duas técnicas principais." },
      { type: "media", id: "video-tecnicas", caption: "Veja as técnicas" },
      { type: "text", content: "A escolha depende do seu objetivo estético." },
    ]);
    expect(result.mediaIds).toEqual(["video-tecnicas"]);
  });

  it("trata content step como once=true por padrão quando um bloco já apareceu", () => {
    expect(
      hasPipelineContentStepBeenSent(contentStep, [
        {
          author: "agent",
          body: "Claro. As lentes em resina têm duas técnicas principais.",
        },
      ]),
    ).toBe(true);
  });

  it("permite repetição explícita quando once=false", () => {
    expect(
      hasPipelineContentStepBeenSent(
        { ...contentStep, once: false },
        [
          {
            author: "agent",
            body: "As lentes em resina têm duas técnicas principais.",
          },
        ],
      ),
    ).toBe(false);
  });

  it("não considera mensagem do lead como conteúdo enviado pelo sistema", () => {
    expect(
      hasPipelineContentStepBeenSent(contentStep, [
        {
          author: "lead",
          body: "As lentes em resina têm duas técnicas principais?",
        },
      ]),
    ).toBe(false);
  });

  it("infere tratamento com pipeline para pedido de valores a partir do histórico recente", () => {
    const treatments: Treatment[] = [
      {
        id: "lentes",
        name: "Lentes em Resina Composta",
        aliases: ["lentes", "lentes de resina"],
        pipelineSteps: [contentStep],
        keywordMatchEnabled: true,
      } as Treatment,
      {
        id: "avaliacao",
        name: "Avaliação Clínica Inicial",
        aliases: ["avaliação"],
        pipelineSteps: null,
        keywordMatchEnabled: true,
      } as Treatment,
    ];

    expect(
      findPipelineTreatmentContextForPriceRequest({
        message: "Ver valores",
        treatments,
        history: [
          {
            author: "lead",
            body: "Olá! Quero saber como posso transformar meu sorriso com as lentes de resina?",
          },
          {
            author: "agent",
            body: "Oi de novo! Ficou alguma dúvida?",
          },
        ],
      })?.id,
    ).toBe("lentes");
  });

  it("não inventa contexto de pipeline quando o pedido de valores é genérico", () => {
    const treatments: Treatment[] = [
      {
        id: "lentes",
        name: "Lentes em Resina Composta",
        aliases: ["lentes", "lentes de resina"],
        pipelineSteps: [contentStep],
        keywordMatchEnabled: true,
      } as Treatment,
    ];

    expect(
      findPipelineTreatmentContextForPriceRequest({
        message: "Ver valores",
        treatments,
        history: [],
      }),
    ).toBeNull();
  });
});
