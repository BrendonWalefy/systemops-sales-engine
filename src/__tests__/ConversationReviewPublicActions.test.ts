/**
 * Testes das server actions públicas da revisão de conversas
 * (docs/product/revisao-conversas-plano.md, seções 6 e 8 — PR 2). Mesmo
 * padrão de mock de `SaveWizardIdentity.test.ts` / `ChannelProvisionRoute.test.ts`
 * (db.query.findFirst + db.update().set().where() mockados).
 *
 * Cobertura exigida pelo plano: token inválido/expirado/já respondido;
 * feedback parcial idempotente; guarda TOCTOU (status=sent) no WHERE;
 * concluir sem nenhum feedback é permitido; comentário geral persistido.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    query: { conversationReviews: { findFirst: vi.fn() } },
    update: vi.fn(),
  },
}));

vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));

import { answerExcerpt, concludeReview } from "@/app/(public)/conversas/[token]/actions";
import type { ConversationExcerpt } from "@/domain/entities/conversation-review";

function baseExcerpt(overrides: Partial<ConversationExcerpt> & { id: string }): ConversationExcerpt {
  return {
    sourceConversationId: "conv-1",
    messages: [{ role: "lead", body: "Oi", sentAt: "2026-07-10T12:00:00Z" }],
    ...overrides,
  };
}

function review(overrides: Record<string, unknown> = {}) {
  return {
    id: "review-1",
    status: "sent",
    expiresAt: new Date("2099-08-01T00:00:00Z"),
    excerpts: [baseExcerpt({ id: "exc-1" })],
    ...overrides,
  };
}

describe("actions públicas /conversas/[token]", () => {
  let setSpy: ReturnType<typeof vi.fn>;
  let whereSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    whereSpy = vi.fn().mockResolvedValue(undefined);
    setSpy = vi.fn().mockReturnValue({ where: whereSpy });
    mocks.db.update.mockReturnValue({ set: setSpy });
  });

  describe("answerExcerpt", () => {
    it("token inválido (rodada não encontrada) → erro, nenhuma escrita", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(undefined);

      await expect(answerExcerpt("tok", "exc-1", { rating: "good" })).rejects.toThrow(
        /link inválido/i,
      );
      expect(mocks.db.update).not.toHaveBeenCalled();
    });

    it("rodada expirada → erro, nenhuma escrita", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(
        review({ expiresAt: new Date("2020-01-01T00:00:00Z") }),
      );

      await expect(answerExcerpt("tok", "exc-1", { rating: "good" })).rejects.toThrow(
        /expirou/i,
      );
      expect(mocks.db.update).not.toHaveBeenCalled();
    });

    it("rodada já respondida → erro, nenhuma escrita", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(review({ status: "answered" }));

      await expect(answerExcerpt("tok", "exc-1", { rating: "good" })).rejects.toThrow(
        /já foi concluída/i,
      );
      expect(mocks.db.update).not.toHaveBeenCalled();
    });

    it("rating fora do enum → rejeitado antes de qualquer escrita", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(review());

      await expect(
        answerExcerpt("tok", "exc-1", { rating: "great" as never }),
      ).rejects.toThrow(/avaliação inválida/i);
      expect(mocks.db.update).not.toHaveBeenCalled();
    });

    it("salva o feedback e grava com guarda TOCTOU (status=sent) no WHERE", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(review());

      await answerExcerpt("tok", "exc-1", { rating: "adjust", comment: "x".repeat(2000) });

      expect(mocks.db.update).toHaveBeenCalledTimes(1);
      const setArg = setSpy.mock.calls[0][0];
      expect(setArg.excerpts[0].feedback.rating).toBe("adjust");
      expect(setArg.excerpts[0].feedback.comment).toHaveLength(1000); // truncado
      expect(whereSpy).toHaveBeenCalledTimes(1);
    });

    it("reresponder o mesmo trecho sobrescreve (idempotente), não acumula", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(review());
      await answerExcerpt("tok", "exc-1", { rating: "good" });

      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(review());
      await answerExcerpt("tok", "exc-1", { rating: "adjust", comment: "novo comentário" });

      const lastSetArg = setSpy.mock.calls[1][0];
      expect(lastSetArg.excerpts[0].feedback).toMatchObject({
        rating: "adjust",
        comment: "novo comentário",
      });
    });
  });

  describe("concludeReview", () => {
    it("token inválido → erro, nenhuma escrita", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(undefined);

      await expect(concludeReview("tok")).rejects.toThrow(/link inválido/i);
      expect(mocks.db.update).not.toHaveBeenCalled();
    });

    it("concluir sem nenhum feedback é permitido", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(review());

      await expect(concludeReview("tok")).resolves.toBeUndefined();
      const setArg = setSpy.mock.calls[0][0];
      expect(setArg.status).toBe("answered");
      expect(setArg.answeredAt).toBeInstanceOf(Date);
      expect(setArg.overallComment).toBeNull();
    });

    it("persiste o comentário geral (trim + corta em 1000 chars)", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(review());

      await concludeReview("tok", "  Adorei! " + "x".repeat(2000));

      const setArg = setSpy.mock.calls[0][0];
      expect(setArg.overallComment.startsWith("Adorei!")).toBe(true);
      expect(setArg.overallComment).toHaveLength(1000);
    });

    it("guarda TOCTOU (status=sent) no WHERE", async () => {
      mocks.db.query.conversationReviews.findFirst.mockResolvedValue(review());

      await concludeReview("tok");

      expect(whereSpy).toHaveBeenCalledTimes(1);
    });
  });
});
