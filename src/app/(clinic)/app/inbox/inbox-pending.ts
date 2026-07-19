export type InboxPendingAction =
  | "doctor_review"
  | "deposit_proof"
  | "deposit_validation";

type ResolvePendingActionInput = {
  latestConversationState: string | null;
  latestStateExpiresAt: Date | null;
  hasPendingHumanReview: boolean;
  attentionReason: string | null;
  now?: Date;
};

// Compatibilidade para conversas criadas antes de todo pedido de avaliação
// passar por human_review_requests. A lista é restrita aos motivos determinísticos
// gravados pelo Orchestrator; não classifica texto livre do lead.
export function isLegacyDoctorReviewReason(reason: string | null): boolean {
  if (!reason) return false;
  return (
    /^Lead enviou (foto|image|vídeo|video|documento|document) para avaliação$/i.test(reason) ||
    /^Caso clínico atípico \(.+\) — avaliar antes de cotar$/i.test(reason) ||
    /^Avaliação A\d+: aguardando decisão humana(?: — .+)?$/i.test(reason)
  );
}

export function resolveInboxPendingAction({
  latestConversationState,
  latestStateExpiresAt,
  hasPendingHumanReview,
  attentionReason,
  now = new Date(),
}: ResolvePendingActionInput): InboxPendingAction | null {
  const latestStateIsActive = !latestStateExpiresAt || latestStateExpiresAt >= now;

  if (latestStateIsActive && latestConversationState === "deposit_proof_received") {
    return "deposit_validation";
  }
  if (latestStateIsActive && latestConversationState === "awaiting_deposit_proof") {
    return "deposit_proof";
  }
  if (hasPendingHumanReview || isLegacyDoctorReviewReason(attentionReason)) {
    return "doctor_review";
  }
  return null;
}

export function pendingActionLabel(action: InboxPendingAction): string {
  if (action === "deposit_proof") return "Aguardando comprovante";
  if (action === "deposit_validation") return "Validar comprovante";
  return "Aguardando doutor";
}
