import { createHash } from "node:crypto";
import type {
  ContentBlock,
  PipelineStep,
} from "@/domain/entities/treatment";

export type PipelinePresentationMode =
  | "preserve"
  | "text_then_media"
  | "media_then_text";

export function pipelineDigest(pipelineSteps: PipelineStep[] | null): string {
  return createHash("sha256")
    .update(JSON.stringify(pipelineSteps ?? null))
    .digest("hex");
}

/**
 * Ajusta somente apresentações cuja semântica é inequívoca.
 *
 * Texto já posicionado depois de uma mídia pode ser preço, conclusão ou CTA.
 * Sem um tipo estrutural que identifique o papel desse texto, movê-lo seria
 * corrupção silenciosa de conteúdo. Nessa situação, a migração aborta e exige
 * `preserve` em vez de adivinhar.
 */
export function transformFirstContentPresentation(
  pipelineSteps: PipelineStep[] | null,
  order: PipelinePresentationMode,
  introTextWhenMissing?: string,
): PipelineStep[] | null {
  if (!pipelineSteps?.length || order === "preserve") return pipelineSteps;
  const firstContentIndex = pipelineSteps.findIndex(
    (step) => step.type === "content" && step.blocks.length > 0,
  );
  if (firstContentIndex < 0) return pipelineSteps;

  const firstContent = pipelineSteps[firstContentIndex]!;
  if (firstContent.type !== "content") return pipelineSteps;

  const mediaBlocks = firstContent.blocks.filter((block) => block.kind === "media");
  const textBlocks = firstContent.blocks.filter((block) => block.kind === "text");
  if (mediaBlocks.length < 2) {
    throw new Error(
      "A apresentação inicial precisa conter pelo menos duas mídias para ser reordenada.",
    );
  }

  const firstMediaIndex = firstContent.blocks.findIndex(
    (block) => block.kind === "media",
  );
  const hasTextAfterMedia = firstContent.blocks.some(
    (block, index) => block.kind === "text" && index > firstMediaIndex,
  );
  const firstTextIndex = firstContent.blocks.findIndex(
    (block) => block.kind === "text",
  );
  const hasMediaAfterText = firstContent.blocks.some(
    (block, index) => block.kind === "media" && index > firstTextIndex,
  );

  if (order === "text_then_media" && hasTextAfterMedia) {
    throw new Error(
      "Texto existente após mídia não pode ser movido com segurança; use --presentation=preserve.",
    );
  }
  if (order === "media_then_text" && firstTextIndex >= 0 && hasMediaAfterText) {
    throw new Error(
      "Texto existente antes de mídia não pode ser movido com segurança; use --presentation=preserve.",
    );
  }

  let targetTextBlocks = textBlocks;
  if (order === "text_then_media" && targetTextBlocks.length === 0) {
    if (!introTextWhenMissing) {
      throw new Error(
        "A apresentação inicial não possui texto introdutório configurado.",
      );
    }
    targetTextBlocks = [{
      kind: "text",
      content: introTextWhenMissing,
    } satisfies ContentBlock];
  }
  if (order === "media_then_text" && introTextWhenMissing) {
    targetTextBlocks = targetTextBlocks.filter(
      (block) => block.content !== introTextWhenMissing,
    );
  }

  const reorderedBlocks = order === "text_then_media"
    ? [...targetTextBlocks, ...mediaBlocks]
    : [...mediaBlocks, ...targetTextBlocks];
  if (JSON.stringify(reorderedBlocks) === JSON.stringify(firstContent.blocks)) {
    return pipelineSteps;
  }

  const reordered = [...pipelineSteps];
  reordered[firstContentIndex] = {
    ...firstContent,
    blocks: reorderedBlocks,
  };
  return reordered;
}

const LEGACY_PIPELINE_HEADING = "TRIGGER DE LENTES";
const CLINIC_CONDUCT_HEADING = "CONDUTA ESPECÍFICA DA CLÍNICA:";

/** Remove do notes apenas o fluxo que agora pertence ao pipeline declarativo. */
export function removeLegacyXimendesPipelineInstructions(
  notes: string | null,
): string | null {
  if (!notes?.includes(LEGACY_PIPELINE_HEADING)) return notes;
  const start = notes.indexOf(LEGACY_PIPELINE_HEADING);
  const end = notes.indexOf(CLINIC_CONDUCT_HEADING, start);
  if (start < 0 || end < 0) {
    throw new Error(
      "Notes da Ximendes contém trigger legado, mas não possui o marcador de conduta esperado.",
    );
  }

  const identity = notes.slice(0, start).trimEnd();
  const clinicConduct = notes.slice(end).trimStart();
  return `${identity}\n\n${clinicConduct}`.trim();
}

/**
 * Remove somente os fatos de preço redigitados da política ativa da Ximendes.
 * Os mesmos valores já pertencem a treatments.priceCents/priceUnit e entram no
 * prompt por composePriceSection. O texto de preço depois dos vídeos continua
 * no ContentBlock do pipeline e não é alterado aqui.
 */
export function removeLegacyXimendesCommercialPriceFacts(
  policy: string | null,
): string | null {
  if (!policy?.trim()) return policy;
  const paragraphs = policy.split(/\n{2,}/).map((paragraph) => paragraph.trim());
  return paragraphs
    .map((paragraph) => {
      if (/^A avaliação inicial com o Dr\. Gregorie custa R\$/i.test(paragraph)) {
        return "Ao falar da avaliação inicial com o Dr. Gregorie, mencione o abatimento integral informado pelo sistema, mas somente na etapa de agendamento ou quando o lead perguntar sobre o custo da avaliação.";
      }
      if (/^Para lentes de resina, único procedimento com valor autorizado por mensagem:/i.test(paragraph)) {
        return "Para lentes de resina, informe somente os valores fornecidos pelo sistema. Sempre diga \"a partir de\" e que o valor exato depende da avaliação presencial. Responda primeiro a dúvida principal do lead e só conduza para a avaliação quando houver interesse real ou quando ele pedir disponibilidade.";
      }
      return paragraph;
    })
    .filter(Boolean)
    .join("\n\n");
}
