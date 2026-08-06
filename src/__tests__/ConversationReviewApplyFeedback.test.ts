/**
 * Testes do núcleo puro de aplicação de feedback da Revisão de Conversas
 * (feature catalogada em docs/features.md). Mesmo
 * padrão de `ConversationReviewBuildExcerpt.test.ts`: builder puro testado
 * sem tocar o banco.
 */

import { describe, expect, it } from "vitest";
import {
  applyExcerptFeedback,
  buildConcludeReviewPatch,
  normalizeFeedbackText,
} from "@/application/conversation-review/apply-feedback";
import type { ConversationExcerpt } from "@/domain/entities/conversation-review";

function excerpt(overrides: Partial<ConversationExcerpt> & { id: string }): ConversationExcerpt {
  return {
    sourceConversationId: "conv-1",
    messages: [{ role: "lead", body: "Oi", sentAt: "2026-07-10T12:00:00Z" }],
    ...overrides,
  };
}

const NOW = new Date("2026-07-14T10:00:00Z");

describe("normalizeFeedbackText", () => {
  it("trim + corta em MAX_FEEDBACK_TEXT_CHARS (1000)", () => {
    expect(normalizeFeedbackText("  olá  ")).toBe("olá");
    expect(normalizeFeedbackText("x".repeat(2000))).toHaveLength(1000);
  });

  it("texto vazio (ou só espaço) vira undefined — campo é opcional", () => {
    expect(normalizeFeedbackText(undefined)).toBeUndefined();
    expect(normalizeFeedbackText("")).toBeUndefined();
    expect(normalizeFeedbackText("   ")).toBeUndefined();
  });
});

describe("applyExcerptFeedback", () => {
  const excerpts = [excerpt({ id: "a" }), excerpt({ id: "b" })];

  it("rejeita rating fora do enum", () => {
    expect(() =>
      applyExcerptFeedback(excerpts, "a", { rating: "great" as never }, NOW),
    ).toThrow(/avaliação inválida/i);
  });

  it("rejeita trecho inexistente", () => {
    expect(() =>
      applyExcerptFeedback(excerpts, "nao-existe", { rating: "good" }, NOW),
    ).toThrow(/não encontrado/i);
  });

  it("'good' sem comentário: feedback só com rating + answeredAt (sem chaves vazias)", () => {
    const next = applyExcerptFeedback(excerpts, "a", { rating: "good" }, NOW);
    expect(next.find((e) => e.id === "a")?.feedback).toEqual({
      rating: "good",
      answeredAt: NOW.toISOString(),
    });
  });

  it("'adjust' com comentário e sugestão de resposta", () => {
    const next = applyExcerptFeedback(
      excerpts,
      "a",
      { rating: "adjust", comment: "Muito longo", suggestedReply: "Diria assim..." },
      NOW,
    );
    expect(next.find((e) => e.id === "a")?.feedback).toEqual({
      rating: "adjust",
      comment: "Muito longo",
      suggestedReply: "Diria assim...",
      answeredAt: NOW.toISOString(),
    });
  });

  it("trunca comment/suggestedReply em 1000 chars", () => {
    const next = applyExcerptFeedback(
      excerpts,
      "a",
      { rating: "adjust", comment: "c".repeat(1500), suggestedReply: "r".repeat(1500) },
      NOW,
    );
    const fb = next.find((e) => e.id === "a")?.feedback;
    expect(fb?.comment).toHaveLength(1000);
    expect(fb?.suggestedReply).toHaveLength(1000);
  });

  it("reresponder o mesmo trecho sobrescreve (idempotente), não acumula com o feedback anterior", () => {
    const first = applyExcerptFeedback(excerpts, "a", { rating: "good" }, NOW);
    const second = applyExcerptFeedback(
      first,
      "a",
      { rating: "adjust", comment: "mudei de ideia" },
      NOW,
    );
    expect(second.find((e) => e.id === "a")?.feedback).toEqual({
      rating: "adjust",
      comment: "mudei de ideia",
      answeredAt: NOW.toISOString(),
    });
  });

  it("não altera outros trechos nem muta o array/objetos originais", () => {
    const next = applyExcerptFeedback(excerpts, "a", { rating: "good" }, NOW);
    expect(next.find((e) => e.id === "b")?.feedback).toBeUndefined();
    expect(excerpts.find((e) => e.id === "a")?.feedback).toBeUndefined();
    expect(next).not.toBe(excerpts);
  });
});

describe("buildConcludeReviewPatch", () => {
  it("sem comentário → overallComment null, status answered (concluir sem feedback é permitido)", () => {
    expect(buildConcludeReviewPatch(undefined, NOW)).toEqual({
      overallComment: null,
      status: "answered",
      answeredAt: NOW,
    });
  });

  it("comentário só com espaço → null", () => {
    expect(buildConcludeReviewPatch("   ", NOW).overallComment).toBeNull();
  });

  it("comentário preenchido → trim + corta em 1000 chars", () => {
    const patch = buildConcludeReviewPatch("  Adorei!  ", NOW);
    expect(patch.overallComment).toBe("Adorei!");

    const long = buildConcludeReviewPatch("c".repeat(2000), NOW);
    expect(long.overallComment).toHaveLength(1000);
  });
});
