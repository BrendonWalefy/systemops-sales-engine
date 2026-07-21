import { describe, expect, it } from "vitest";
import {
  buildHumanReviewButtons,
  buildHumanReviewContextUpdateMessage,
  buildHumanReviewDecisionConfirmation,
  buildHumanReviewFollowUpAckMessage,
  buildHumanReviewInvalidReplyMessage,
  buildHumanReviewManualAttentionReason,
  buildHumanReviewPendingLeadMessage,
  buildHumanReviewRequestMessage,
  isMalformedHumanReviewReply,
  parseHumanReviewReply,
  shouldPauseAutomationAfterHumanReviewDecision,
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
      { id: "human-review:27:1", label: "Agendar" },
      { id: "human-review:27:2", label: "Avaliação presencial" },
      { id: "human-review:27:3", label: "Eu respondo" },
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

  it("cabe em uma mensagem só e diz que basta o código", () => {
    // Antes eram duas mensagens repetindo o mesmo bloco, e o fallback
    // ("A27 1 — Apto para agendar aplicação/procedimento") parecia exigir a
    // linha inteira. Feedback do cliente em 21/07.
    const message = buildHumanReviewRequestMessage({
      reviewCode: 27,
      leadName: "João Silva",
      treatmentName: "Lentes em Resina Composta",
      mediaLabel: "foto",
    });

    expect(message).toContain("João Silva");
    expect(message).toContain("Lentes em Resina Composta");
    expect(message).toContain("Responda só o código");
    expect(message).toContain("*A27 1*");
    expect(message).toContain("\n4 não indicado");
    // Enxuta o bastante para não virar parede de texto no WhatsApp.
    expect(message.split("\n").length).toBeLessThanOrEqual(9);
  });

  it("sem tratamento identificado, não deixa a linha de contexto vazia", () => {
    const message = buildHumanReviewRequestMessage({
      reviewCode: 3,
      leadName: "Nataly",
      treatmentName: null,
      mediaLabel: "foto",
    });
    expect(message).toContain("não identificado");
  });

  it("identifica atualizações do paciente e mantém resposta clínica pausada", () => {
    expect(
      buildHumanReviewContextUpdateMessage({
        reviewCode: 2,
        leadName: "Nataly",
        leadMessage: "Pouca resina + clareamento",
      }),
    ).toContain("Informação nova — Avaliação A2");
    expect(buildHumanReviewPendingLeadMessage("Nataly Silva")).toContain("Recebi sua foto, Nataly");
    expect(buildHumanReviewPendingLeadMessage("Nataly Silva")).toContain("automação fica pausada");
  });

  // Replay 20/07 (Simone): o aviso completo saiu 4 vezes na mesma conversa, um
  // por mensagem enviada enquanto a revisão seguia pendente. O ack de follow-up
  // reconhece sem reexplicar a pausa que o lead já leu.
  it("usa ack curto no follow-up, sem repetir a explicação da pausa", () => {
    const ack = buildHumanReviewFollowUpAckMessage("Simone De Paula");
    expect(ack).toContain("Simone");
    expect(ack).not.toContain("automação fica pausada");
    expect(ack).not.toContain("Recebi sua foto");
    // Uma linha só — o texto longo é o de primeiro contato.
    expect(ack.split("\n")).toHaveLength(1);
  });

  it("ack de follow-up funciona sem nome do lead, sem vírgula de saudação órfã", () => {
    const ack = buildHumanReviewFollowUpAckMessage(null);
    expect(ack.startsWith("Anotei aqui e")).toBe(true);
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

  it("pausa a IA apenas nas decisões que exigem humano", () => {
    expect(shouldPauseAutomationAfterHumanReviewDecision("approved_direct_booking")).toBe(false);
    expect(shouldPauseAutomationAfterHumanReviewDecision("needs_evaluation")).toBe(false);
    expect(shouldPauseAutomationAfterHumanReviewDecision("manual_reply")).toBe(true);
    expect(shouldPauseAutomationAfterHumanReviewDecision("not_eligible")).toBe(true);

    expect(
      buildHumanReviewManualAttentionReason({
        reviewCode: 27,
        decision: "manual_reply",
      }),
    ).toBe("Avaliação A27: resposta manual solicitada pelo doutor");

    expect(
      buildHumanReviewManualAttentionReason({
        reviewCode: 28,
        decision: "not_eligible",
      }),
    ).toBe("Avaliação A28: não indicado pelo doutor");
  });
});
