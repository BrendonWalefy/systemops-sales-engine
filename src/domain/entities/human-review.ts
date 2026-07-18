export type HumanReviewDecision =
  | "approved_direct_booking"
  | "needs_evaluation"
  | "manual_reply"
  | "not_eligible";

export type HumanReviewStatus = "pending" | "decided" | "expired" | "cancelled";

export type HumanReviewDecisionSource = "whatsapp" | "panel";

export type ParsedHumanReviewReply = {
  reviewCode: number;
  option: 1 | 2 | 3 | 4;
  decision: HumanReviewDecision;
};

const OPTION_TO_DECISION: Record<1 | 2 | 3 | 4, HumanReviewDecision> = {
  1: "approved_direct_booking",
  2: "needs_evaluation",
  3: "manual_reply",
  4: "not_eligible",
};

export function parseHumanReviewReply(text: string): ParsedHumanReviewReply | null {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const match = normalized.match(/^(?:caso\s*)?(\d{1,3})\s*[-:.,]?\s*([1-4])$/);
  if (!match) return null;

  const reviewCode = Number(match[1]);
  const option = Number(match[2]) as 1 | 2 | 3 | 4;
  if (!Number.isInteger(reviewCode) || reviewCode < 1 || reviewCode > 999) return null;

  return {
    reviewCode,
    option,
    decision: OPTION_TO_DECISION[option],
  };
}

export function buildHumanReviewRequestMessage(params: {
  reviewCode: number;
  leadName: string;
  treatmentName: string | null;
  mediaLabel: string;
}): string {
  const treatmentLine = params.treatmentName
    ? `Tratamento: ${params.treatmentName}`
    : "Tratamento: não identificado";

  return [
    "📸 *Avaliação necessária*",
    "",
    `Caso ${params.reviewCode}`,
    `Paciente: ${params.leadName}`,
    treatmentLine,
    `Mídia: ${params.mediaLabel} recebida`,
    "",
    "Responda:",
    `${params.reviewCode} 1 — Apto para agendar aplicação/procedimento`,
    `${params.reviewCode} 2 — Precisa avaliação presencial`,
    `${params.reviewCode} 3 — Responder manualmente`,
    `${params.reviewCode} 4 — Não indicado`,
  ].join("\n");
}

export function buildHumanReviewDecisionConfirmation(params: {
  reviewCode: number;
  leadName: string;
  decision: HumanReviewDecision;
}): string {
  const decisionText: Record<HumanReviewDecision, string> = {
    approved_direct_booking: "apto para agendar o procedimento. A IA vai oferecer horários disponíveis agora.",
    needs_evaluation: "precisa de avaliação presencial. A IA vai oferecer horários de avaliação agora.",
    manual_reply: "mantido para resposta manual. A IA continuará pausada.",
    not_eligible: "marcado como não indicado. A IA continuará pausada.",
  };

  return `Confirmado: Caso ${params.reviewCode}, ${params.leadName} — ${decisionText[params.decision]}`;
}

export function buildHumanReviewInvalidReplyMessage(): string {
  return "Para evitar erro, responda com o número do caso e a opção. Ex: 27 1";
}
