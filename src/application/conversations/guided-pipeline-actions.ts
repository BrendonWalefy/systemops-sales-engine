import type { ContentBlock, PipelineStep } from "@/domain/entities/treatment";

// Ação guiada do Inbox: coloca a conversa no trilho do pipeline e reprocessa a
// última mensagem do lead pelo Orchestrator — a IA responde answer-first e os
// próximos passos avançam conforme as respostas do lead, igual ao fluxo normal.
// (Substitui a antiga send_intro_until_photo, que despejava todos os blocos de
// uma vez sem pacing — comportamento rejeitado em validação real, 18/07/2026.)
export const GUIDED_PIPELINE_ACTION_START_RAILS = "start_pipeline_rails" as const;

export type GuidedPipelineAction = typeof GUIDED_PIPELINE_ACTION_START_RAILS;

export type GuidedPipelinePart =
  | { type: "text"; content: string }
  | { type: "media"; mediaId: string; caption?: string };

export type GuidedPipelinePackage = {
  action: GuidedPipelineAction;
  parts: GuidedPipelinePart[];
  resumeStepIndex: number | null;
};

export type GuidedPipelineSummary = {
  action: GuidedPipelineAction;
  label: string;
  textParts: number;
  mediaParts: number;
  preview: string | null;
  willWaitForPhoto: boolean;
};

function contentBlockToPart(block: ContentBlock): GuidedPipelinePart | null {
  if (block.kind === "text") {
    const content = block.content.trim();
    return content ? { type: "text", content } : null;
  }
  return { type: "media", mediaId: block.mediaId, caption: block.caption };
}

// O pacote hoje serve como PRÉVIA para o operador (o que o lead vai receber ao
// longo do trilho) — o envio em si é conduzido passo a passo pelo Orchestrator.
export function buildGuidedPipelinePackage(
  pipelineSteps: PipelineStep[] | null | undefined,
  action: GuidedPipelineAction = GUIDED_PIPELINE_ACTION_START_RAILS,
): GuidedPipelinePackage {
  if (action !== GUIDED_PIPELINE_ACTION_START_RAILS) {
    return { action, parts: [], resumeStepIndex: null };
  }

  const parts: GuidedPipelinePart[] = [];
  const steps = pipelineSteps ?? [];

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.type === "content") {
      for (const block of step.blocks) {
        const part = contentBlockToPart(block);
        if (part) parts.push(part);
      }
      continue;
    }

    if (step.type === "photo") {
      const message = step.message.trim();
      if (message) parts.push({ type: "text", content: message });
      return { action, parts, resumeStepIndex: index };
    }
  }

  return { action, parts, resumeStepIndex: null };
}

export function summarizeGuidedPipelinePackage(pkg: GuidedPipelinePackage): GuidedPipelineSummary {
  const firstText = pkg.parts.find((part) => part.type === "text");
  return {
    action: pkg.action,
    label: "Entrar no fluxo — IA conduz passo a passo",
    textParts: pkg.parts.filter((part) => part.type === "text").length,
    mediaParts: pkg.parts.filter((part) => part.type === "media").length,
    preview: firstText?.content.slice(0, 120) ?? null,
    willWaitForPhoto: pkg.resumeStepIndex !== null,
  };
}
