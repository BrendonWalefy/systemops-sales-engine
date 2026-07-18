import { describe, expect, it } from "vitest";
import {
  buildHumanReviewButtons,
  buildHumanReviewDecisionConfirmation,
  buildHumanReviewInvalidReplyMessage,
  buildHumanReviewRequestMessage,
  isMalformedHumanReviewReply,
  parseHumanReviewReply,
} from "@/domain/entities/human-review";

describe("human review WhatsApp decisions", () => {
  it("exige código da avaliação + opção", () => {
    expect(parseHumanReviewReply("A27 1")).toEqual({
      reviewCode: 27,
      option: 1,
      decision: "approved_direct_booking",
    });
    expect(parseHumanReviewReply("a27 2")).toEqual({
      reviewCode: 27,
      option: 2,
      decision: "needs_evaluation",
    });
    expect(parseHumanReviewReply("A 27:3")).toEqual({
      reviewCode: 27,
      option: 3,
      decision: "manual_reply",
    });
    expect(parseHumanReviewReply("27 1")).toBeNull();
    expect(parseHumanReviewReply("caso 27 2")).toBeNull();
    expect(parseHumanReviewReply("1")).toBeNull();
    expect(parseHumanReviewReply("pode agendar")).toBeNull();
  });

  it("parseia ids determinísticos dos botões", () => {
    expect(buildHumanReviewButtons(27)).toEqual([
      { id: "human-review:27:1", label: "Agendar direto" },
      { id: "human-review:27:2", label: "Avaliação presencial" },
      { id: "human-review:27:3", label: "Responder manual" },
      { id: "human-review:27:4", label: "Não indicado" },
    ]);
    expect(parseHumanReviewReply("human-review:27:1")).toEqual({
      reviewCode: 27,
      option: 1,
      decision: "approved_direct_booking",
    });
    expect(parseHumanReviewReply("human-review:27:4")).toEqual({
      reviewCode: 27,
      option: 4,
      decision: "not_eligible",
    });
  });

  it("detecta respostas de avaliação incompletas para ajuda determinística", () => {
    expect(isMalformedHumanReviewReply("A27")).toBe(true);
    expect(isMalformedHumanReviewReply("a")).toBe(true);
    expect(isMalformedHumanReviewReply("agendar")).toBe(false);
    expect(buildHumanReviewInvalidReplyMessage()).toContain("Ex: A27 1");
  });

  it("mapeia as quatro decisões permitidas", () => {
    expect(parseHumanReviewReply("A8 1")?.decision).toBe("approved_direct_booking");
    expect(parseHumanReviewReply("A8 2")?.decision).toBe("needs_evaluation");
    expect(parseHumanReviewReply("A8 3")?.decision).toBe("manual_reply");
    expect(parseHumanReviewReply("A8 4")?.decision).toBe("not_eligible");
  });

  it("gera instrução curta e segura para o responsável", () => {
    const message = buildHumanReviewRequestMessage({
      reviewCode: 27,
      leadName: "João Silva",
      treatmentName: "Lentes em Resina Composta",
      mediaLabel: "foto",
    });

    expect(message).toContain("Código A27");
    expect(message).toContain("Paciente: João Silva");
    expect(message).toContain("Toque em um botão");
    expect(message).toContain("Se os botões não aparecerem");
    expect(message).toContain("A27 1");
    expect(message).toContain("A27 4");
  });

  it("confirma a decisão com nome do paciente e instrui resposta inválida", () => {
    expect(
      buildHumanReviewDecisionConfirmation({
        reviewCode: 27,
        leadName: "João Silva",
        decision: "approved_direct_booking",
      }),
    ).toContain("A IA vai oferecer horários disponíveis agora");

    expect(buildHumanReviewInvalidReplyMessage()).toContain("Ex: A27 1");
  });
});
