import { describe, expect, it } from "vitest";
import {
  pipelineDigest,
  removeLegacyXimendesPipelineInstructions,
  transformFirstContentPresentation,
} from "@/application/config/pipeline-family-migration";
import type { PipelineStep } from "@/domain/entities/treatment";

const XIMENDES_PRICE_TEXT =
  "- Técnica Simplificada começa a partir de R$ 2.000.\n" +
  "- Técnica Estratificada começa a partir de R$ 4.000.";

function presentation(
  blocks: Extract<PipelineStep, { type: "content" }>["blocks"],
): PipelineStep[] {
  return [{
    type: "content",
    label: "Vídeos das Técnicas",
    blocks,
  }];
}

describe("transformFirstContentPresentation", () => {
  it("preserva byte a byte vídeo, vídeo e preços da Ximendes", () => {
    const source = presentation([
      { kind: "media", mediaId: "simplificada", caption: "Simplificada" },
      { kind: "media", mediaId: "estratificada", caption: "Estratificada" },
      { kind: "text", content: XIMENDES_PRICE_TEXT },
    ]);

    const target = transformFirstContentPresentation(source, "preserve");

    expect(target).toBe(source);
    expect(pipelineDigest(target)).toBe(pipelineDigest(source));
    expect(
      (target?.[0] as Extract<PipelineStep, { type: "content" }>).blocks
        .map((block) => block.kind),
    ).toEqual(["media", "media", "text"]);
  });

  it("aborta em vez de mover um texto que já está depois das mídias", () => {
    const source = presentation([
      { kind: "media", mediaId: "simplificada" },
      { kind: "media", mediaId: "estratificada" },
      { kind: "text", content: XIMENDES_PRICE_TEXT },
    ]);

    expect(() =>
      transformFirstContentPresentation(
        source,
        "text_then_media",
        "Vou mostrar as técnicas:",
      )
    ).toThrow("use --presentation=preserve");
  });

  it("adiciona introdução antes de duas mídias quando não existe outro texto", () => {
    const source = presentation([
      { kind: "media", mediaId: "simplificada" },
      { kind: "media", mediaId: "estratificada" },
    ]);

    const target = transformFirstContentPresentation(
      source,
      "text_then_media",
      "Vou mostrar as técnicas:",
    );

    expect(
      (target?.[0] as Extract<PipelineStep, { type: "content" }>).blocks,
    ).toEqual([
      { kind: "text", content: "Vou mostrar as técnicas:" },
      { kind: "media", mediaId: "simplificada" },
      { kind: "media", mediaId: "estratificada" },
    ]);
  });
});

describe("removeLegacyXimendesPipelineInstructions", () => {
  it("remove apenas a orientação duplicada e preserva identidade e conduta", () => {
    const notes = `ESPECIALIDADE DO DR. GREGORIE:
O Dr. Gregorie é especialista em lentes.

TRIGGER DE LENTES — execute SEMPRE.

Passo 1 — envie os vídeos.
Passo 2 — espere antes de informar preços.

CONDUTA ESPECÍFICA DA CLÍNICA:
Só ofereça agendamento quando houver interesse real.`;

    expect(removeLegacyXimendesPipelineInstructions(notes)).toBe(
      `ESPECIALIDADE DO DR. GREGORIE:
O Dr. Gregorie é especialista em lentes.

CONDUTA ESPECÍFICA DA CLÍNICA:
Só ofereça agendamento quando houver interesse real.`,
    );
  });

  it("é idempotente quando o trigger legado já foi removido", () => {
    const notes = "ESPECIALIDADE\n\nCONDUTA ESPECÍFICA DA CLÍNICA:\nTexto";
    expect(removeLegacyXimendesPipelineInstructions(notes)).toBe(notes);
  });
});
