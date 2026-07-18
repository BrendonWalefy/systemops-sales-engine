import { describe, expect, it } from "vitest";
import {
  buildHumanReviewDecisionConfirmation,
  buildHumanReviewInvalidReplyMessage,
  buildHumanReviewRequestMessage,
  parseHumanReviewReply,
} from "@/domain/entities/human-review";

describe("human review WhatsApp decisions", () => {
  it("exige código do caso + opção", () => {
    expect(parseHumanReviewReply("27 1")).toEqual({
      reviewCode: 27,
      option: 1,
      decision: "approved_direct_booking",
    });
    expect(parseHumanReviewReply("caso 27 2")).toEqual({
      reviewCode: 27,
      option: 2,
      decision: "needs_evaluation",
    });
    expect(parseHumanReviewReply("1")).toBeNull();
    expect(parseHumanReviewReply("pode agendar")).toBeNull();
  });

  it("mapeia as quatro decisões permitidas", () => {
    expect(parseHumanReviewReply("8 1")?.decision).toBe("approved_direct_booking");
    expect(parseHumanReviewReply("8 2")?.decision).toBe("needs_evaluation");
    expect(parseHumanReviewReply("8 3")?.decision).toBe("manual_reply");
    expect(parseHumanReviewReply("8 4")?.decision).toBe("not_eligible");
  });

  it("gera instrução curta e segura para o responsável", () => {
    const message = buildHumanReviewRequestMessage({
      reviewCode: 27,
      leadName: "João Silva",
      treatmentName: "Lentes em Resina Composta",
      mediaLabel: "foto",
    });

    expect(message).toContain("Caso 27");
    expect(message).toContain("Paciente: João Silva");
    expect(message).toContain("27 1");
    expect(message).toContain("27 4");
  });

  it("confirma a decisão com nome do paciente e instrui resposta inválida", () => {
    expect(
      buildHumanReviewDecisionConfirmation({
        reviewCode: 27,
        leadName: "João Silva",
        decision: "approved_direct_booking",
      }),
    ).toContain("A IA vai oferecer horários disponíveis agora");

    expect(buildHumanReviewInvalidReplyMessage()).toContain("Ex: 27 1");
  });
});
