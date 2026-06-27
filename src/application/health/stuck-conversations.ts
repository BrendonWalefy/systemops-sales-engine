export type StuckConversationCandidate = {
  conversationId: string;
  clinicId: string;
  leadName: string | null;
  leadPhone: string;
  latestMessageAuthor: "lead" | "agent" | "clinic_user" | "system";
  latestMessageAt: Date;
  latestMessageBody: string;
  // Quando a IA foi reativada após pausa (TTL expirado ou operador retomou).
  // Mensagens enviadas pelo lead ANTES desta data foram recebidas durante atendimento
  // humano — a IA estava intencionalmente pausada e não deve contar como "stuck".
  aiResumedAt: Date | null;
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
//
// Exceção: se a mensagem do lead foi enviada ANTES de aiResumedAt, significa que
// foi recebida durante atendimento humano (takeover) — a IA estava intencionalmente
// pausada. Após o TTL expirar e a IA retomar, essa mensagem antiga não é "stuck".
export function findStuckConversationAlerts(
  candidates: StuckConversationCandidate[],
  now: Date,
  thresholdMs: number,
): StuckConversationAlert[] {
  return candidates
    .filter((candidate) => candidate.latestMessageAuthor === "lead")
    .filter((candidate) => {
      // Ignora mensagens enviadas antes da última retomada da IA: eram do período
      // de atendimento humano e não exigem resposta automática.
      if (
        candidate.aiResumedAt &&
        candidate.latestMessageAt <= candidate.aiResumedAt
      ) {
        return false;
      }
      return true;
    })
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
