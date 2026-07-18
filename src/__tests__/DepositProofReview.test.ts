import { describe, expect, it } from "vitest";
import {
  buildDepositProofDecisionConfirmation,
  buildDepositProofInvalidReplyMessage,
  buildDepositProofReviewRequestMessage,
  isMalformedDepositProofReviewReply,
  parseDepositProofReviewReply,
} from "@/application/conversations/deposit-proof-review";

describe("DepositProofReview", () => {
  it("parses short Pix review replies without colliding with human review case replies", () => {
    expect(parseDepositProofReviewReply("P12 1")).toEqual({ reviewCode: 12, action: "confirm" });
    expect(parseDepositProofReviewReply("pix12 2")).toEqual({ reviewCode: 12, action: "reject" });
    expect(parseDepositProofReviewReply("pix 7:1")).toEqual({ reviewCode: 7, action: "confirm" });
    expect(parseDepositProofReviewReply("12 1")).toBeNull();
  });

  it("detects malformed Pix replies for a deterministic help message", () => {
    expect(isMalformedDepositProofReviewReply("P12")).toBe(true);
    expect(isMalformedDepositProofReviewReply("pix")).toBe(true);
    expect(isMalformedDepositProofReviewReply("Caso 12")).toBe(false);
    expect(buildDepositProofInvalidReplyMessage()).toContain("P12 1");
  });

  it("builds the WhatsApp instruction sent to the doctor", () => {
    const message = buildDepositProofReviewRequestMessage({
      reviewCode: 12,
      leadName: "Vitor",
      slotLabel: "Seg 21/07 às 16h",
      depositAmountCents: 3000,
    });

    expect(message).toContain("Código P12");
    expect(message).toContain("Paciente: Vitor");
    expect(message).toContain("Horário reservado: Seg 21/07 às 16h");
    expect(message).toContain("P12 1");
    expect(message).toContain("P12 2");
    expect(message).not.toMatch(/painel/i);
  });

  it("confirms the doctor's Pix decision in plain language", () => {
    expect(buildDepositProofDecisionConfirmation({ reviewCode: 12, leadName: "Vitor", action: "confirm" }))
      .toContain("Pix validado");
    expect(buildDepositProofDecisionConfirmation({ reviewCode: 12, leadName: "Vitor", action: "reject" }))
      .toContain("Pix não localizado");
  });
});
