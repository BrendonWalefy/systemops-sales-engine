import type { FollowUp } from "@/domain/entities/follow-up";

// Janela em que atividade recente de um operador humano na conversa suprime o
// reengajamento automático (auditoria jul/2026 F4: reengagement disparando por
// cima de atendimento humano em andamento — casos Flavia, Cida, Pedro).
export const OPERATOR_ACTIVE_WINDOW_MS = 12 * 60 * 60 * 1000;

// O follow-up suprimido volta a "pending" e é reavaliado na próxima execução do
// dispatcher — quando o takeover expirar ou o operador sair da conversa.
export function shouldSuppressFollowUpForOperatorActivity(params: {
  aiPaused: boolean;
  lastMessageAuthor: string | null;
  lastMessageSentAt: Date | null;
  now: Date;
}): boolean {
  if (params.aiPaused) return true;
  if (params.lastMessageAuthor !== "clinic_user" || !params.lastMessageSentAt) return false;
  return params.now.getTime() - params.lastMessageSentAt.getTime() < OPERATOR_ACTIVE_WINDOW_MS;
}

export function selectOneFollowUpPerLead(followUps: FollowUp[]): {
  selected: FollowUp[];
  deferred: FollowUp[];
} {
  const seenLeadIds = new Set<string>();
  const selected: FollowUp[] = [];
  const deferred: FollowUp[] = [];

  for (const followUp of followUps) {
    if (seenLeadIds.has(followUp.leadId)) {
      deferred.push(followUp);
      continue;
    }

    seenLeadIds.add(followUp.leadId);
    selected.push(followUp);
  }

  return { selected, deferred };
}
