import { describe, expect, it } from "vitest";
import {
  buildDepositProofButtonPromptMessage,
  buildDepositProofDecisionConfirmation,
  buildDepositProofInvalidReplyMessage,
  buildDepositProofButtons,
  buildDepositProofReviewRequestMessage,
  extractDepositProofReviewInput,
  isMalformedDepositProofReviewReply,
  parseDepositProofReviewReply,
} from "@/application/conversations/deposit-proof-review";

describe("DepositProofReview", () => {
  it("parses short Pix review replies without colliding with human review case replies", () => {
    expect(parseDepositProofReviewReply("P12 1")).toEqual({ reviewCode: 12, action: "confirm" });
    expect(parseDepositProofReviewReply("p12 1")).toEqual({ reviewCode: 12, action: "confirm" });
    expect(parseDepositProofReviewReply("pix12 2")).toEqual({ reviewCode: 12, action: "reject" });
    expect(parseDepositProofReviewReply("pix 7:1")).toEqual({ reviewCode: 7, action: "confirm" });
    expect(parseDepositProofReviewReply("12 1")).toBeNull();
  });

  it("parses deterministic quick reply button ids", () => {
    expect(buildDepositProofButtons(12)).toEqual([
      { id: "deposit:12:confirm", label: "Confirmar Pix" },
      { id: "deposit:12:reject", label: "Pix não localizado" },
    ]);
    expect(parseDepositProofReviewReply("deposit:12:confirm")).toEqual({ reviewCode: 12, action: "confirm" });
    expect(parseDepositProofReviewReply("deposit:12:reject")).toEqual({ reviewCode: 12, action: "reject" });
  });

  it("extracts review input from common Z-API button webhook shapes", () => {
    expect(extractDepositProofReviewInput({ buttonsResponseMessage: { buttonId: "deposit:12:confirm" } }))
      .toBe("deposit:12:confirm");
    expect(extractDepositProofReviewInput({ buttonReply: { id: "deposit:12:reject", title: "Pix não localizado" } }))
      .toBe("deposit:12:reject");
    expect(extractDepositProofReviewInput({ interactive: { button_reply: { id: "deposit:7:confirm" } } }))
      .toBe("deposit:7:confirm");
    expect(extractDepositProofReviewInput({ text: { message: "P12 1" } })).toBe("P12 1");
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
    expect(message).toContain("Toque em um botão");
    expect(message).toContain("Se os botões não aparecerem");
    expect(message).toContain("P12 1");
    expect(message).toContain("P12 2");
    expect(message).not.toMatch(/painel/i);
  });

  it("builds a compact button prompt with manual fallback", () => {
    const message = buildDepositProofButtonPromptMessage(12);

    expect(message).toContain("P12");
    expect(message).toContain("Se os botões não aparecerem");
    expect(message).toContain("P12 1");
    expect(message).toContain("P12 2");
  });

  it("confirms the doctor's Pix decision in plain language", () => {
    expect(buildDepositProofDecisionConfirmation({ reviewCode: 12, leadName: "Vitor", action: "confirm" }))
      .toContain("Pix validado");
    expect(buildDepositProofDecisionConfirmation({ reviewCode: 12, leadName: "Vitor", action: "reject" }))
      .toContain("Pix não localizado");
  });
});
