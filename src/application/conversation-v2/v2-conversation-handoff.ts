export type V2ConversationHandoffReason =
  | "v2_objection_requires_human"
  | "v2_cancel_reschedule_requires_human"
  | "v2_explicit_human_request"
  | "v2_human_review_continuation_requires_human"
  | "v2_manual_recovery_requires_human"
  | "v2_guided_pipeline_requires_human"
  | "v2_effect_outbox_failure_requires_human"
  | "v2_reschedule_compensation_requires_human"
  | "v2_clinical_urgency_requires_human"
  | "v2_existing_treatment_problem_requires_human"
  | "v2_patient_arrival_requires_human"
  | "v2_patient_delay_requires_human"
  | "v2_clinical_evaluation_requires_human";

export type V2ConversationHandoffStore = Readonly<{
  markRequired(input: Readonly<{
    clinicId: string;
    conversationId: string;
    reason: V2ConversationHandoffReason;
    now: Date;
  }>): Promise<boolean>;
}>;

export async function requireV2ConversationHandoff(
  store: V2ConversationHandoffStore,
  input: Parameters<V2ConversationHandoffStore["markRequired"]>[0],
): Promise<void> {
  if (!await store.markRequired(input)) {
    throw new Error("V2 handoff tenant relationship binding mismatch");
  }
}
