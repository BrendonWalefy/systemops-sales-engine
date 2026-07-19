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

export function buildHumanReviewButtonIds(reviewCode: number): Record<1 | 2 | 3 | 4, string> {
  return {
    1: `human-review:${reviewCode}:1`,
    2: `human-review:${reviewCode}:2`,
    3: `human-review:${reviewCode}:3`,
    4: `human-review:${reviewCode}:4`,
  };
}

export function buildHumanReviewButtons(reviewCode: number): { id: string; label: string }[] {
  const ids = buildHumanReviewButtonIds(reviewCode);
  return [
    { id: ids[1], label: "Agendar direto" },
    { id: ids[2], label: "Avaliação presencial" },
    { id: ids[3], label: "Responder manual" },
    { id: ids[4], label: "Não indicado" },
  ];
}

export function parseHumanReviewReply(text: string): ParsedHumanReviewReply | null {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const buttonMatch = normalized.match(/^human-review:(\d{1,3}):([1-4])$/);
  if (buttonMatch) {
    const reviewCode = Number(buttonMatch[1]);
    const option = Number(buttonMatch[2]) as 1 | 2 | 3 | 4;
    if (!Number.isInteger(reviewCode) || reviewCode < 1 || reviewCode > 999) return null;

    return {
      reviewCode,
      option,
      decision: OPTION_TO_DECISION[option],
    };
  }

  const match = normalized.match(/^a\s*(\d{1,3})\s*[-:.,]?\s*([1-4])$/);
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

export function isMalformedHumanReviewReply(text: string): boolean {
  const trimmed = text.trim();
  return /^a$/i.test(trimmed) || /^a\s*\d{1,3}\b/i.test(trimmed);
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
  const code = `A${params.reviewCode}`;

  return [
    "📸 *Avaliação necessária*",
    "",
    `Código ${code}`,
    `Paciente: ${params.leadName}`,
    treatmentLine,
    `Mídia: ${params.mediaLabel} recebida`,
    "",
    "Toque em um botão abaixo.",
    "",
    "Se os botões não aparecerem, responda:",
    `${code} 1 — Apto para agendar aplicação/procedimento`,
    `${code} 2 — Precisa avaliação presencial`,
    `${code} 3 — Responder manualmente`,
    `${code} 4 — Não indicado`,
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

  return `Confirmado: A${params.reviewCode}, ${params.leadName} — ${decisionText[params.decision]}`;
}

export function shouldPauseAutomationAfterHumanReviewDecision(
  decision: HumanReviewDecision,
): decision is Extract<HumanReviewDecision, "manual_reply" | "not_eligible"> {
  return decision === "manual_reply" || decision === "not_eligible";
}

export function buildHumanReviewManualAttentionReason(params: {
  reviewCode: number;
  decision: Extract<HumanReviewDecision, "manual_reply" | "not_eligible">;
}): string {
  const label = params.decision === "manual_reply"
    ? "resposta manual solicitada pelo doutor"
    : "não indicado pelo doutor";
  return `Avaliação A${params.reviewCode}: ${label}`;
}

export function buildHumanReviewInvalidReplyMessage(): string {
  return "Para evitar erro, responda com o código da avaliação e a opção. Ex: A27 1";
}
