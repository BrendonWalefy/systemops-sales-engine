import { describe, expect, it } from "vitest";
import {
  buildAnswerFirstPipelineContent,
  buildDeferredPipelineAnswerContext,
  trimAnswerToBridge,
} from "@/core/pipeline/ConversationOrchestrator";

// Regressão do replay Vitalli 18/07: no answer-first, o composer respondia a
// pergunta técnica por completo E o conteúdo do pipeline (enviado na mesma
// resposta) explicava tudo de novo — duas respostas para a mesma dúvida.

describe("buildDeferredPipelineAnswerContext", () => {
  const context = buildDeferredPipelineAnswerContext({
    treatmentName: "Lentes em Resina Composta",
    contentBlocks: [
      { kind: "text", content: "Trabalhamos com duas técnicas, já com os valores dos pacotes 👇" },
      { kind: "media", mediaId: "m1", caption: "Valores Lente em Resina Premium" },
      { kind: "media", mediaId: "m2" },
    ],
    treatmentDescription: "Lentes personalizadas",
    commercialPolicy: "Pix com 5% de desconto",
  });

  it("mostra ao composer o conteúdo que será enviado na mesma resposta", () => {
    expect(context).toContain("CONTEÚDO QUE SERÁ ENVIADO");
    expect(context).toContain("duas técnicas, já com os valores");
    expect(context).toContain("[mídia anexada: Valores Lente em Resina Premium]");
    expect(context).toContain("[mídia anexada]");
  });

  it("proíbe repetir o conteúdo e limita a resposta à ponte curta", () => {
    expect(context).toContain("NO MÁXIMO 2 frases");
    expect(context).toContain("NÃO repita nem resuma o conteúdo");
    // Redação mesclada: além de não convidar para agendamento, mantém as
    // proibições que a wave 3/4 já tinha no prompt inline que esta função
    // substituiu — não convidar para avaliação e não pedir foto.
    expect(context).toContain("NÃO convide para avaliação/agendamento");
    expect(context).toContain("NÃO peça foto");
  });

  it("mantém descrição e política apenas como contexto", () => {
    expect(context).toContain("Lentes personalizadas");
    expect(context).toContain("Pix com 5% de desconto");
  });
});

describe("trimAnswerToBridge — enforcement determinístico da ponte curta", () => {
  it("corta a resposta no primeiro parágrafo quando o LLM se alonga", () => {
    const longAnswer = [
      "Fico feliz que esteja bem! As lentes têm muitos benefícios.",
      "A principal diferença entre as técnicas está na composição da resina...",
      "Que tal agendarmos uma avaliação para discutir suas necessidades?",
    ].join("\n\n");

    expect(trimAnswerToBridge(longAnswer)).toBe(
      "Fico feliz que esteja bem! As lentes têm muitos benefícios.",
    );
  });

  it("mantém intacta uma ponte que já é curta", () => {
    expect(trimAnswerToBridge("Estou bem, obrigada! 😊")).toBe("Estou bem, obrigada! 😊");
  });

  it("monta a resposta final como ponte + conteúdo do pipeline, sem os parágrafos extras", () => {
    const result = buildAnswerFirstPipelineContent({
      answerText: "Estou bem, obrigada! 😊\n\nAs lentes em resina têm muitos benefícios e duas técnicas...\n\nQue tal agendarmos?",
      answerParts: [{ type: "text", content: "ignorado — reconstruído da ponte" }],
      contentBlocks: [
        { kind: "text", content: "Trabalhamos com duas técnicas 👇" },
        { kind: "media", mediaId: "m1", caption: "Valores Premium" },
      ],
    });

    expect(result.replyText).toBe("Estou bem, obrigada! 😊\n\nTrabalhamos com duas técnicas 👇");
    expect(result.replyText).not.toContain("Que tal agendarmos");
    expect(result.parts[0]).toEqual({ type: "text", content: "Estou bem, obrigada! 😊" });
    expect(result.mediaIds).toEqual(["m1"]);
  });
});
