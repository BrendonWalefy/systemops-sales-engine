/**
 * Aplicação pura do feedback do cliente na Revisão de Conversas
 * (docs/product/revisao-conversas-plano.md, seções 6 e 8 — PR 2).
 *
 * Mesmo padrão de `build-excerpt.ts`: núcleo puro e testável sem tocar o
 * banco; as actions públicas (`(public)/conversas/[token]/actions.ts`) ficam
 * finas — só resolvem o token, chamam este módulo e gravam o resultado com a
 * guarda TOCTOU no WHERE.
 *
 * Feedback é sempre opcional (Apêndice D): `applyExcerptFeedback` só roda
 * quando o cliente toca em 👍/✏️ num trecho — concluir a revisão nunca
 * depende de nenhum trecho ter sido respondido.
 */

import type {
  ConversationExcerpt,
  ExcerptFeedback,
  ExcerptFeedbackRating,
} from "@/domain/entities/conversation-review";
import { MAX_FEEDBACK_TEXT_CHARS } from "@/domain/entities/conversation-review";

/** Entrada crua do cliente ao responder um trecho na página pública. */
export interface ExcerptFeedbackInput {
  rating: ExcerptFeedbackRating;
  comment?: string;
  suggestedReply?: string;
}

/**
 * `.trim().slice(0, MAX_FEEDBACK_TEXT_CHARS)` (mesmo limite da validação);
 * texto vazio (ou só espaço) vira `undefined` — os campos são opcionais.
 */
export function normalizeFeedbackText(raw: string | undefined): string | undefined {
  const trimmed = (raw ?? "").trim().slice(0, MAX_FEEDBACK_TEXT_CHARS);
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Núcleo puro de `answerExcerpt`: valida o `rating`, normaliza os textos
 * livres e devolve um novo array de trechos com o feedback do trecho
 * `excerptId` substituído (POST parcial idempotente — reenviar o mesmo
 * trecho sobrescreve o feedback anterior, nunca acumula). Não muta
 * `excerpts` nem os objetos que ele contém.
 *
 * Lança `Error` com mensagem segura para o cliente (rating fora do enum,
 * trecho inexistente) — mesmo estilo de `build-excerpt.ts`.
 */
export function applyExcerptFeedback(
  excerpts: ConversationExcerpt[],
  excerptId: string,
  input: ExcerptFeedbackInput,
  now: Date = new Date(),
): ConversationExcerpt[] {
  if (input.rating !== "good" && input.rating !== "adjust") {
    throw new Error("Avaliação inválida.");
  }
  if (!excerpts.some((e) => e.id === excerptId)) {
    throw new Error("Trecho não encontrado.");
  }

  const comment = normalizeFeedbackText(input.comment);
  const suggestedReply = normalizeFeedbackText(input.suggestedReply);

  const feedback: ExcerptFeedback = {
    rating: input.rating,
    ...(comment ? { comment } : {}),
    ...(suggestedReply ? { suggestedReply } : {}),
    answeredAt: now.toISOString(),
  };

  return excerpts.map((e) => (e.id === excerptId ? { ...e, feedback } : e));
}

/** O que `concludeReview` grava no banco. */
export interface ConcludeReviewPatch {
  overallComment: string | null;
  status: "answered";
  answeredAt: Date;
}

/**
 * Núcleo puro de `concludeReview`. Sem gate de "todo trecho respondido" —
 * feedback é opcional por decisão de produto (Apêndice D), então concluir é
 * sempre permitido. Só normaliza o comentário geral opcional.
 */
export function buildConcludeReviewPatch(
  overallComment: string | undefined,
  now: Date = new Date(),
): ConcludeReviewPatch {
  return {
    overallComment: normalizeFeedbackText(overallComment) ?? null,
    status: "answered",
    answeredAt: now,
  };
}
