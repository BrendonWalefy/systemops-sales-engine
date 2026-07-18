import { and, eq, gte, isNull, or } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversationStates, conversations, leads } from "@/infrastructure/db/schema";
import type { DepositFlowPayload } from "@/core/conversation/ConversationStateMachine";

export type DepositProofDecision = "confirm" | "reject";

export type ParsedDepositProofReviewReply = {
  reviewCode: number;
  action: DepositProofDecision;
};

export function buildDepositProofButtonIds(reviewCode: number): { confirm: string; reject: string } {
  return {
    confirm: `deposit:${reviewCode}:confirm`,
    reject: `deposit:${reviewCode}:reject`,
  };
}

export function buildDepositProofButtons(reviewCode: number): { id: string; label: string }[] {
  const ids = buildDepositProofButtonIds(reviewCode);
  return [
    { id: ids.confirm, label: "Confirmar Pix" },
    { id: ids.reject, label: "Pix não localizado" },
  ];
}

export function parseDepositProofReviewReply(text: string): ParsedDepositProofReviewReply | null {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const buttonMatch = normalized.match(/^deposit:(\d{1,3}):(confirm|reject)$/);
  if (buttonMatch) {
    const reviewCode = Number(buttonMatch[1]);
    if (!Number.isInteger(reviewCode) || reviewCode < 1 || reviewCode > 999) return null;
    return {
      reviewCode,
      action: buttonMatch[2] === "confirm" ? "confirm" : "reject",
    };
  }

  const match = normalized.match(/^(?:p|pix)\s*(\d{1,3})\s*[-:.,]?\s*([12])$/);
  if (!match) return null;

  const reviewCode = Number(match[1]);
  const option = Number(match[2]);
  if (!Number.isInteger(reviewCode) || reviewCode < 1 || reviewCode > 999) return null;

  return {
    reviewCode,
    action: option === 1 ? "confirm" : "reject",
  };
}

export function isMalformedDepositProofReviewReply(text: string): boolean {
  return /^(?:p|pix)\b/i.test(text.trim()) || /^(?:p|pix)\d{1,3}\b/i.test(text.trim());
}

function formatAmount(cents: number | null | undefined): string {
  if (!cents) return "valor do sinal";
  return `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function buildDepositProofReviewRequestMessage(params: {
  reviewCode: number;
  leadName: string;
  slotLabel: string;
  depositAmountCents: number | null;
}): string {
  const code = `P${params.reviewCode}`;
  return [
    "💸 *Comprovante de sinal recebido*",
    "",
    `Código ${code}`,
    `Paciente: ${params.leadName}`,
    `Horário reservado: ${params.slotLabel}`,
    `Sinal: ${formatAmount(params.depositAmountCents)}`,
    "",
    "Valide se o Pix entrou na conta.",
    "",
    "Toque em um botão abaixo.",
    "",
    "Se os botões não aparecerem, responda:",
    `${code} 1 — Pix confirmado; confirmar agendamento`,
    `${code} 2 — Pix não localizado; atendimento manual`,
  ].join("\n");
}

export function extractDepositProofReviewInput(payload: {
  text?: { message?: string };
  buttonsResponseMessage?: {
    buttonId?: string;
    selectedButtonId?: string;
    selectedDisplayText?: string;
    message?: string;
  };
  buttonReply?: {
    id?: string;
    title?: string;
    text?: string;
  };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  buttonId?: string;
  selectedButtonId?: string;
  selectedDisplayText?: string;
}): string | null {
  return (
    payload.buttonsResponseMessage?.buttonId ??
    payload.buttonsResponseMessage?.selectedButtonId ??
    payload.buttonReply?.id ??
    payload.interactive?.button_reply?.id ??
    payload.interactive?.list_reply?.id ??
    payload.buttonId ??
    payload.selectedButtonId ??
    payload.text?.message ??
    payload.buttonsResponseMessage?.selectedDisplayText ??
    payload.buttonsResponseMessage?.message ??
    payload.buttonReply?.title ??
    payload.buttonReply?.text ??
    payload.interactive?.button_reply?.title ??
    payload.interactive?.list_reply?.title ??
    payload.selectedDisplayText ??
    null
  );
}

export function buildDepositProofDecisionConfirmation(params: {
  reviewCode: number;
  leadName: string;
  action: DepositProofDecision;
}): string {
  const code = `P${params.reviewCode}`;
  if (params.action === "confirm") {
    return `Confirmado: ${code}, ${params.leadName} — Pix validado. O agendamento será confirmado para o paciente.`;
  }
  return `Confirmado: ${code}, ${params.leadName} — Pix não localizado. A conversa seguirá para atendimento manual.`;
}

export function buildDepositProofInvalidReplyMessage(): string {
  return "Para evitar erro, responda com o código Pix e a opção. Ex: P12 1";
}

function payloadHasReviewCode(payload: unknown, reviewCode: number): payload is DepositFlowPayload {
  if (!payload || typeof payload !== "object") return false;
  return (payload as DepositFlowPayload).proofReviewCode === reviewCode;
}

export async function nextAvailableDepositProofReviewCode(clinicId: string): Promise<number> {
  const rows = await db
    .select({ payload: conversationStates.payload })
    .from(conversationStates)
    .innerJoin(conversations, eq(conversations.id, conversationStates.conversationId))
    .where(
      and(
        eq(conversations.clinicId, clinicId),
        eq(conversationStates.state, "deposit_proof_received"),
        or(isNull(conversationStates.expiresAt), gte(conversationStates.expiresAt, new Date())),
      ),
    );

  const used = new Set<number>();
  for (const row of rows) {
    const code = (row.payload as Partial<DepositFlowPayload> | null)?.proofReviewCode;
    if (typeof code === "number") used.add(code);
  }

  for (let code = 1; code <= 999; code += 1) {
    if (!used.has(code)) return code;
  }
  throw new Error("deposit_review_code_exhausted");
}

export async function findPendingDepositProofByCode(params: {
  clinicId: string;
  reviewCode: number;
}): Promise<{
  conversationId: string;
  leadId: string;
  leadName: string | null;
  payload: DepositFlowPayload;
} | null> {
  const rows = await db
    .select({
      conversationId: conversationStates.conversationId,
      leadId: conversations.leadId,
      leadName: leads.name,
      payload: conversationStates.payload,
      createdAt: conversationStates.createdAt,
    })
    .from(conversationStates)
    .innerJoin(conversations, eq(conversations.id, conversationStates.conversationId))
    .innerJoin(leads, eq(leads.id, conversations.leadId))
    .where(
      and(
        eq(conversations.clinicId, params.clinicId),
        eq(conversationStates.state, "deposit_proof_received"),
        or(isNull(conversationStates.expiresAt), gte(conversationStates.expiresAt, new Date())),
      ),
    )
    .orderBy(conversationStates.createdAt);

  for (const row of rows.reverse()) {
    if (!payloadHasReviewCode(row.payload, params.reviewCode)) continue;
    return {
      conversationId: row.conversationId,
      leadId: row.leadId,
      leadName: row.leadName,
      payload: row.payload,
    };
  }

  return null;
}
