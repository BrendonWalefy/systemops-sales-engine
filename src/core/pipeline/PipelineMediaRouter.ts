import type { TreatmentPipelinePayload } from "@/core/conversation/ConversationStateMachine";
import type { Treatment } from "@/domain/entities/treatment";

export type PipelineMediaRoute =
  | { kind: "outside_pipeline" }
  | { kind: "not_photo_context" }
  | { kind: "invalid_pipeline_target"; reason: string }
  | {
      kind: "human_review";
      pipelineTreatment: Treatment;
      targetTreatment: Treatment;
      sourceStepIndex: number;
      sourceStepType: "photo" | "qa";
    };

/**
 * Decide a rota da mídia usando somente estado persistido e catálogo. O caption
 * e o LLM nunca escolhem o tratamento dono da foto.
 */
export function resolvePipelineMediaRoute(input: {
  mediaType: string | null | undefined;
  state: TreatmentPipelinePayload | null;
  treatments: Treatment[];
}): PipelineMediaRoute {
  if (input.mediaType !== "image" && input.mediaType !== "video") {
    return { kind: "outside_pipeline" };
  }
  if (!input.state) return { kind: "outside_pipeline" };

  const pipelineTreatment = input.treatments.find(
    (treatment) => treatment.id === input.state!.treatmentId,
  );
  if (!pipelineTreatment?.pipelineSteps) {
    return {
      kind: "invalid_pipeline_target",
      reason: "pipeline_treatment_missing_or_without_steps",
    };
  }
  const currentStep = pipelineTreatment.pipelineSteps[input.state.stepIndex];
  const hasPhotoStepAhead = pipelineTreatment.pipelineSteps.some(
    (step, index) => index > input.state!.stepIndex && step.type === "photo",
  );
  if (
    currentStep?.type !== "photo" &&
    !(currentStep?.type === "qa" && hasPhotoStepAhead)
  ) {
    return { kind: "not_photo_context" };
  }

  const targetTreatment = input.state.selectedTreatmentId
    ? input.treatments.find(
        (treatment) => treatment.id === input.state!.selectedTreatmentId,
      )
    : pipelineTreatment;
  if (!targetTreatment) {
    return { kind: "invalid_pipeline_target", reason: "selected_treatment_missing" };
  }
  if (
    targetTreatment.id !== pipelineTreatment.id &&
    targetTreatment.pipelineSourceTreatmentId !== pipelineTreatment.id
  ) {
    return {
      kind: "invalid_pipeline_target",
      reason: "selected_treatment_does_not_belong_to_pipeline_family",
    };
  }

  return {
    kind: "human_review",
    pipelineTreatment,
    targetTreatment,
    sourceStepIndex: input.state.stepIndex,
    sourceStepType: currentStep.type,
  };
}

export function matchesHumanReviewPipelineContext(input: {
  state: TreatmentPipelinePayload | null;
  pipelineTreatmentId: string | null;
  targetTreatmentId: string | null;
}): boolean {
  if (!input.pipelineTreatmentId) return true;
  if (!input.state || input.state.treatmentId !== input.pipelineTreatmentId) return false;
  const activeTargetId = input.state.selectedTreatmentId ?? input.state.treatmentId;
  return !input.targetTreatmentId || activeTargetId === input.targetTreatmentId;
}
