export type StuckConversationCandidate = {
  conversationId: string;
  clinicId: string;
  leadName: string | null;
  leadPhone: string;
  latestMessageAuthor: "lead" | "agent" | "clinic_user" | "system";
  latestMessageAt: Date;
  latestMessageBody: string;
};

export type StuckConversationAlert = {
  conversationId: string;
  clinicId: string;
  leadDisplayName: string;
  minutesStuck: number;
  attentionReason: string;
  pushTitle: string;
  pushBody: string;
};

// Uma conversa está "travada" quando a última mensagem da thread é do lead
// (a IA deveria ter respondido) e já passou tempo suficiente além do pior
// caso normal de processamento (debounce + claim + chamada de LLM).
export function findStuckConversationAlerts(
  candidates: StuckConversationCandidate[],
  now: Date,
  thresholdMs: number,
): StuckConversationAlert[] {
  return candidates
    .filter((candidate) => candidate.latestMessageAuthor === "lead")
    .filter(
      (candidate) =>
        now.getTime() - candidate.latestMessageAt.getTime() >= thresholdMs,
    )
    .map((candidate) => {
      const minutesStuck = Math.round(
        (now.getTime() - candidate.latestMessageAt.getTime()) / 60_000,
      );
      const leadDisplayName = candidate.leadName ?? candidate.leadPhone;

      return {
        conversationId: candidate.conversationId,
        clinicId: candidate.clinicId,
        leadDisplayName,
        minutesStuck,
        attentionReason: `Sem resposta automática há ${minutesStuck}min — possível falha no processamento`,
        pushTitle: leadDisplayName,
        pushBody: candidate.latestMessageBody.slice(0, 100),
      };
    });
}
