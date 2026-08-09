"use server";

/**
 * Server actions da página pública de revisão de conversas
 * Feature catalogada em docs/features.md.
 *
 * SEGURANÇA / MULTI-TENANT:
 * - A rodada é resolvida **exclusivamente** pelo hash sha256 do token. Nem
 *   `clinicId` nem `reviewId` trafegam na URL ou no payload — o cliente só
 *   conhece o token cru.
 * - Rate limit dispensado na v1: o token tem 256 bits de entropia, tornando
 *   brute-force inviável (decisão registrada no ADR-002, apêndice G, e
 *   repetida no plano da revisão de conversas, seção 10).
 * - Só age em rodada com status "sent" e dentro da validade. Rodada em
 *   draft, expirada ou já respondida não é mutável por aqui.
 */

import { db } from "@/infrastructure/db/client";
import { conversationReviews } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import {
  hashAccessToken,
  resolvePublicDocState,
} from "@/application/public-link/access-token";
import {
  applyExcerptFeedback,
  buildConcludeReviewPatch,
} from "@/application/conversation-review/apply-feedback";
import type {
  ConversationExcerpt,
  ExcerptFeedbackRating,
} from "@/domain/entities/conversation-review";

/** Erro de negócio genérico da página pública (sem vazar detalhes de tenant). */
class ConversationReviewError extends Error {}

/** Resolve a rodada "sent" e navegável a partir do token cru. */
async function loadOpenReviewByToken(token: string): Promise<{
  id: string;
  excerpts: ConversationExcerpt[];
}> {
  const hash = hashAccessToken(token);
  const review = await db.query.conversationReviews.findFirst({
    where: eq(conversationReviews.accessTokenHash, hash),
  });

  const state = resolvePublicDocState(review, new Date());
  if (state !== "valid" || !review) {
    throw new ConversationReviewError(
      state === "expired"
        ? "Este link expirou."
        : state === "answered"
          ? "Esta revisão já foi concluída."
          : "Link inválido.",
    );
  }

  return { id: review.id, excerpts: (review.excerpts ?? []) as ConversationExcerpt[] };
}

/**
 * Salva o feedback de um único trecho (POST parcial, idempotente). Reenviar
 * o mesmo `excerptId` sobrescreve o feedback anterior — nunca acumula.
 * `rating` só aceita "good" | "adjust"; comentário e sugestão de resposta são
 * opcionais e truncados em 1000 chars (Apêndice D/H, ver `apply-feedback.ts`).
 */
export async function answerExcerpt(
  token: string,
  excerptId: string,
  input: { rating: ExcerptFeedbackRating; comment?: string; suggestedReply?: string },
): Promise<void> {
  const review = await loadOpenReviewByToken(token);

  const nextExcerpts = applyExcerptFeedback(review.excerpts, excerptId, input);

  // Guarda defensiva de status no WHERE (além da checagem na leitura): evita
  // gravar numa rodada que saiu de "sent" entre a leitura e a escrita (TOCTOU).
  await db
    .update(conversationReviews)
    .set({ excerpts: nextExcerpts, updatedAt: new Date() })
    .where(and(eq(conversationReviews.id, review.id), eq(conversationReviews.status, "sent")));
}

/**
 * Conclui a revisão: feedback é 100% opcional (Apêndice D) — concluir NUNCA
 * exige que algum trecho tenha sido respondido. Grava o comentário geral (se
 * houver), muda o status para "answered" e carimba `answered_at`. Idempotente
 * do ponto de vista do cliente: se já foi concluída, a página mostra o estado
 * "concluído" antes mesmo de chamar esta action.
 */
export async function concludeReview(
  token: string,
  overallComment?: string,
): Promise<void> {
  const review = await loadOpenReviewByToken(token);

  const patch = buildConcludeReviewPatch(overallComment);

  await db
    .update(conversationReviews)
    .set({
      overallComment: patch.overallComment,
      status: patch.status,
      answeredAt: patch.answeredAt,
      updatedAt: new Date(),
    })
    .where(and(eq(conversationReviews.id, review.id), eq(conversationReviews.status, "sent")));
}
