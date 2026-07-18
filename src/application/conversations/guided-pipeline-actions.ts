import type { ContentBlock, PipelineStep } from "@/domain/entities/treatment";

export const GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO = "send_intro_until_photo" as const;

export type GuidedPipelineAction = typeof GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO;

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

export function buildGuidedPipelinePackage(
  pipelineSteps: PipelineStep[] | null | undefined,
  action: GuidedPipelineAction = GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO,
): GuidedPipelinePackage {
  if (action !== GUIDED_PIPELINE_ACTION_SEND_INTRO_UNTIL_PHOTO) {
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
    label: "Apresentacao + pedido de foto",
    textParts: pkg.parts.filter((part) => part.type === "text").length,
    mediaParts: pkg.parts.filter((part) => part.type === "media").length,
    preview: firstText?.content.slice(0, 120) ?? null,
    willWaitForPhoto: pkg.resumeStepIndex !== null,
  };
}
