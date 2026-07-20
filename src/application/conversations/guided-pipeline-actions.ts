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

export type GuidedPipelineContentDraft = {
  parts: GuidedPipelinePart[];
  text: string;
  mediaIds: string[];
};

export type GuidedPipelineSection = {
  stepIndex: number;
  stepNumber: number;
  type: PipelineStep["type"];
  label: string;
  // "schedule": etapa de fechamento que exige um horário escolhido pelo operador.
  mode: "send" | "arm" | "automatic" | "schedule";
  actionLabel: string;
  textParts: number;
  mediaParts: number;
  preview: string | null;
};

// Capacidades da clínica que tornam etapas de fechamento acionáveis. Vem da
// config da própria organização (deposit_enabled/valor) — nenhuma clínica é
// tratada de forma especial no código.
export type GuidedPipelineClinicCapabilities = {
  depositEnabled?: boolean;
};

function contentBlockToPart(block: ContentBlock): GuidedPipelinePart | null {
  if (block.kind === "text") {
    const content = block.content.trim();
    return content ? { type: "text", content } : null;
  }
  return { type: "media", mediaId: block.mediaId, caption: block.caption };
}

export function buildGuidedPipelineContentDraft(
  step: PipelineStep,
): GuidedPipelineContentDraft | null {
  if (step.type !== "content") return null;

  const parts = step.blocks
    .map(contentBlockToPart)
    .filter((part): part is GuidedPipelinePart => part !== null);
  if (parts.length === 0) return { parts: [], text: "", mediaIds: [] };

  return {
    parts,
    text: parts
      .filter((part): part is Extract<GuidedPipelinePart, { type: "text" }> => part.type === "text")
      .map((part) => part.content)
      .join("\n\n"),
    mediaIds: Array.from(
      new Set(parts.filter((part): part is Extract<GuidedPipelinePart, { type: "media" }> => part.type === "media").map((part) => part.mediaId)),
    ),
  };
}

export function buildGuidedPipelineStepDraft(
  step: PipelineStep,
): GuidedPipelineContentDraft | null {
  const contentDraft = buildGuidedPipelineContentDraft(step);
  if (contentDraft) return contentDraft;
  if (step.type !== "photo") return null;

  const message = step.message.trim();
  return {
    parts: message ? [{ type: "text", content: message }] : [],
    text: message,
    mediaIds: [],
  };
}

export function listGuidedPipelineSections(
  pipelineSteps: PipelineStep[] | null | undefined,
  capabilities: GuidedPipelineClinicCapabilities = {},
): GuidedPipelineSection[] {
  return (pipelineSteps ?? []).map((step, stepIndex) => {
    const draft = buildGuidedPipelineStepDraft(step);
    const textParts = draft?.parts.filter((part) => part.type === "text").length ?? 0;
    const mediaParts = draft?.parts.filter((part) => part.type === "media").length ?? 0;
    const preview = draft?.parts.find((part) => part.type === "text")?.content.slice(0, 120) ??
      (step.type === "qa" ? step.instruction?.trim().slice(0, 120) ?? null : null);
    // A etapa de fechamento ("book") só vira acionável quando a clínica cobra
    // sinal: aí o operador reserva o horário provisoriamente e o pedido de sinal
    // engata a máquina de estado (comprovante → validação → confirmação).
    // Sem sinal configurado ela segue automática, como antes.
    const bookIsActionable = step.type === "book" && capabilities.depositEnabled === true;
    const mode = step.type === "content" || step.type === "photo"
      ? "send"
      : step.type === "qa"
        ? "arm"
        : bookIsActionable
          ? "schedule"
          : "automatic";
    const actionLabel = mode === "send"
      ? step.type === "photo" ? "Enviar pedido e aguardar foto" : "Enviar esta etapa"
      : mode === "arm"
        ? "Ativar a IA nesta etapa"
        : mode === "schedule"
          ? "Reservar horário e pedir sinal"
          : "Etapa automática";

    return {
      stepIndex,
      stepNumber: stepIndex + 1,
      type: step.type,
      label: step.label,
      mode,
      actionLabel,
      textParts,
      mediaParts,
      preview,
    };
  });
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
