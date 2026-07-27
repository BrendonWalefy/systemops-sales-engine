import { describe, expect, it } from "vitest";
import {
  pipelineDigest,
  removeLegacyXimendesPipelineInstructions,
  removeLegacyXimendesCommercialPriceFacts,
  removeLegacyXimendesQaOwnershipDuplication,
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

describe("removeLegacyXimendesCommercialPriceFacts", () => {
  it("preserva a conduta e remove somente os preços duplicados", () => {
    const policy = [
      "A avaliação inicial com o Dr. Gregorie custa R$ 100 e esse valor é integralmente abatido do tratamento se o paciente decidir avançar. Sempre mencione esse abatimento ao falar da avaliação. mas só mencione quanto estiver na etapa de agendamento, ou se o lead perguntar sobre custo de avaliação",
      "Para lentes de resina, único procedimento com valor autorizado por mensagem: Técnica Simplificada a partir de R$ 2.000 para vinte elementos, e Técnica Estratificada a partir de R$ 4.000 para vinte elementos. Sempre diga \"a partir de\" e que o valor exato depende da avaliação presencial. Responda primeiro a dúvida principal do lead e só conduza para a avaliação quando houver interesse real ou quando ele pedir disponibilidade.",
      "Parcelamento em até 12 vezes.",
    ].join("\n\n");

    const migrated = removeLegacyXimendesCommercialPriceFacts(policy);
    expect(migrated).not.toContain("R$");
    expect(migrated).toContain("abatimento integral informado pelo sistema");
    expect(migrated).toContain("informe somente os valores fornecidos pelo sistema");
    expect(migrated).toContain("Parcelamento em até 12 vezes.");
  });

  it("não altera uma política que já está sem fatos duplicados", () => {
    const policy = "Parcelamento em até 12 vezes.";
    expect(removeLegacyXimendesCommercialPriceFacts(policy)).toBe(policy);
  });
});

describe("removeLegacyXimendesQaOwnershipDuplication", () => {
  it("remove apresentação e preço, preservando orientação específica do QA", () => {
    const source: PipelineStep[] = [{
      type: "qa",
      label: "Dúvidas e objeções",
      instruction: [
        "Cumprimente o lead de forma calorosa e personalizada, sempre se apresentando como Marina, assistente virtual da Ximendes Odontologia.",
        "Use mensagens curtas, com quebras de linha e tom receptivo.",
        "Exemplo:",
        "Oi, João! Tudo bem? 😊\nAqui é a Marina, assistente virtual da Ximendes Odontologia.",
        "Responda dúvidas sobre valores e tratamentos de forma direta, mas acolhedora.",
        "Ao explicar a avaliação, utilize:",
        "A avaliação clínica inicial tem o valor de R$ 100. Caso realize o tratamento, o valor é abatido.",
        "Quando o lead demonstrar interesse, avance para a solicitação das fotos.",
        "Se o lead perguntar sobre cores ou tonalidades, explique as opções disponíveis.",
      ].join("\n\n"),
    }];

    const migrated = removeLegacyXimendesQaOwnershipDuplication(source);
    const instruction = (migrated?.[0] as Extract<PipelineStep, { type: "qa" }>).instruction;

    expect(instruction).not.toContain("Marina");
    expect(instruction).not.toContain("R$ 100");
    expect(instruction).toContain("mensagens curtas");
    expect(instruction).toContain("solicitação das fotos");
    expect(instruction).toContain("cores ou tonalidades");
  });

  it("é idempotente quando o QA já respeita os donos canônicos", () => {
    const source: PipelineStep[] = [{
      type: "qa",
      label: "Dúvidas",
      instruction: "Responda dúvidas com clareza e avance para fotos quando houver interesse.",
    }];
    expect(removeLegacyXimendesQaOwnershipDuplication(source)).toBe(source);
  });
});
