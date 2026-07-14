"use server";

/**
 * Server actions owner da Revisão de Conversas pelo Cliente
 * (docs/product/revisao-conversas-plano.md, seção 7).
 *
 * Padrão copiado de `setup-study-actions.ts`:
 * - `assertOwnerSession()` em toda action;
 * - escopo por `clinicId` da rota em toda query/escrita;
 * - guarda de status esperado no WHERE (não sobrescreve rodada enviada nem
 *   de outra clínica — TOCTOU).
 */

import { db } from "@/infrastructure/db/client";
import { conversationReviews } from "@/infrastructure/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { generateAccessToken } from "@/application/public-link/access-token";
import { buildExcerpt } from "@/application/conversation-review/build-excerpt";
import {
  MIN_EXCERPTS_PER_REVIEW,
  MAX_EXCERPTS_PER_REVIEW,
  MAX_EXCERPT_CONTEXT_CHARS,
  MAX_REVIEW_TITLE_CHARS,
} from "@/domain/entities/conversation-review";
import type { ConversationExcerpt } from "@/domain/entities/conversation-review";

/** Validade do link público da revisão (Apêndice H — espelha VALIDATION_LINK_TTL_DAYS). */
const CONVERSATION_REVIEW_LINK_TTL_DAYS = 7;

/** Base pública do app — o link é montado pelo owner e enviado ao cliente. */
function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.systemops.com.br";
}

async function assertOwnerSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) throw new Error("Não autorizado");
  const session = await verifyToken(token);
  if (!session || session.role !== "owner") {
    throw new Error("Apenas o owner pode gerenciar revisões de conversas");
  }
}

/** Revalida o card na página da clínica e a subpágina de curadoria. */
function revalidateReviewPaths(clinicId: string, reviewId?: string) {
  revalidatePath(`/owner/clinics/${clinicId}`);
  if (reviewId) {
    revalidatePath(`/owner/clinics/${clinicId}/revisao-conversas/${reviewId}`);
  }
}

/**
 * Cria uma nova rodada de revisão em rascunho. Uma rodada por vez: se já
 * existe uma em andamento (draft ou sent), o owner precisa concluí-la ou
 * expirá-la antes — rodadas answered/expired ficam no histórico.
 */
export async function createReview(
  clinicId: string,
  title: string,
): Promise<{ reviewId: string }> {
  await assertOwnerSession();

  const trimmed = title.trim().slice(0, MAX_REVIEW_TITLE_CHARS);
  if (!trimmed) throw new Error("Dê um título à rodada (ex.: \"Rodada 1 — semana de 14/07\").");

  const active = await db.query.conversationReviews.findFirst({
    where: and(
      eq(conversationReviews.organizationId, clinicId),
      inArray(conversationReviews.status, ["draft", "sent"]),
    ),
    columns: { id: true },
  });
  if (active) {
    throw new Error(
      "Já existe uma rodada em andamento (rascunho ou enviada). Conclua ou expire antes de criar outra.",
    );
  }

  const [created] = await db
    .insert(conversationReviews)
    .values({ organizationId: clinicId, status: "draft", title: trimmed })
    .returning({ id: conversationReviews.id });

  revalidateReviewPaths(clinicId, created.id);
  return { reviewId: created.id };
}

/**
 * Lê os trechos de uma rodada em rascunho, garantindo tenant (clinicId) e
 * status. Retorna null se não existir ou não for editável.
 */
async function loadDraftExcerpts(
  clinicId: string,
  reviewId: string,
): Promise<ConversationExcerpt[] | null> {
  const review = await db.query.conversationReviews.findFirst({
    where: and(
      eq(conversationReviews.id, reviewId),
      eq(conversationReviews.organizationId, clinicId),
      eq(conversationReviews.status, "draft"),
    ),
  });
  if (!review) return null;
  return (review.excerpts ?? []) as ConversationExcerpt[];
}

/**
 * Curadoria: monta um trecho congelado a partir de mensagens de uma conversa
 * do shadow (builder valida tenant da conversa, anonimiza e aplica limites) e
 * o adiciona ao fim da rodada em rascunho.
 */
export async function addExcerpt(
  clinicId: string,
  reviewId: string,
  conversationId: string,
  messageIds: string[],
  context?: string,
): Promise<void> {
  await assertOwnerSession();

  const excerpts = await loadDraftExcerpts(clinicId, reviewId);
  if (!excerpts) throw new Error("Rodada não encontrada ou não editável.");
  if (excerpts.length >= MAX_EXCERPTS_PER_REVIEW) {
    throw new Error(`Uma rodada pode ter no máximo ${MAX_EXCERPTS_PER_REVIEW} trechos.`);
  }

  const excerpt = await buildExcerpt(clinicId, conversationId, messageIds);

  const trimmedContext = context?.trim().slice(0, MAX_EXCERPT_CONTEXT_CHARS);
  const next = [
    ...excerpts,
    trimmedContext ? { ...excerpt, context: trimmedContext } : excerpt,
  ];

  await db
    .update(conversationReviews)
    .set({ excerpts: next, updatedAt: new Date() })
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.organizationId, clinicId),
        eq(conversationReviews.status, "draft"),
      ),
    );

  revalidateReviewPaths(clinicId, reviewId);
}

/** Curadoria: remove um trecho da rodada em rascunho. */
export async function removeExcerpt(
  clinicId: string,
  reviewId: string,
  excerptId: string,
): Promise<void> {
  await assertOwnerSession();

  const excerpts = await loadDraftExcerpts(clinicId, reviewId);
  if (!excerpts) throw new Error("Rodada não encontrada ou não editável.");

  const next = excerpts.filter((e) => e.id !== excerptId);
  await db
    .update(conversationReviews)
    .set({ excerpts: next, updatedAt: new Date() })
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.organizationId, clinicId),
        eq(conversationReviews.status, "draft"),
      ),
    );

  revalidateReviewPaths(clinicId, reviewId);
}

/**
 * Curadoria: move um trecho uma posição para cima ou para baixo (▲▼ — sem
 * drag-and-drop na v1). No limite da lista é no-op.
 */
export async function reorderExcerpt(
  clinicId: string,
  reviewId: string,
  excerptId: string,
  direction: "up" | "down",
): Promise<void> {
  await assertOwnerSession();
  if (direction !== "up" && direction !== "down") {
    throw new Error("Direção inválida.");
  }

  const excerpts = await loadDraftExcerpts(clinicId, reviewId);
  if (!excerpts) throw new Error("Rodada não encontrada ou não editável.");

  const index = excerpts.findIndex((e) => e.id === excerptId);
  if (index === -1) throw new Error("Trecho não encontrado.");

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= excerpts.length) return; // já está na ponta

  const next = [...excerpts];
  [next[index], next[target]] = [next[target], next[index]];

  await db
    .update(conversationReviews)
    .set({ excerpts: next, updatedAt: new Date() })
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.organizationId, clinicId),
        eq(conversationReviews.status, "draft"),
      ),
    );

  revalidateReviewPaths(clinicId, reviewId);
}

/**
 * Curadoria: define/edita a linha de contexto do owner em um trecho
 * ("Lead perguntou preço de lente"). Texto vazio remove o contexto.
 */
export async function updateExcerptContext(
  clinicId: string,
  reviewId: string,
  excerptId: string,
  context: string,
): Promise<void> {
  await assertOwnerSession();

  const excerpts = await loadDraftExcerpts(clinicId, reviewId);
  if (!excerpts) throw new Error("Rodada não encontrada ou não editável.");

  const trimmed = context.trim().slice(0, MAX_EXCERPT_CONTEXT_CHARS);
  const next = excerpts.map((e) => {
    if (e.id !== excerptId) return e;
    if (!trimmed) {
      const rest = { ...e };
      delete rest.context;
      return rest;
    }
    return { ...e, context: trimmed };
  });

  await db
    .update(conversationReviews)
    .set({ excerpts: next, updatedAt: new Date() })
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.organizationId, clinicId),
        eq(conversationReviews.status, "draft"),
      ),
    );

  revalidateReviewPaths(clinicId, reviewId);
}

/**
 * Envia a rodada para o cliente: gera token (padrão API key — retornado uma
 * única vez), grava **apenas o hash**, muda status para "sent" e define
 * validade de 7 dias. O owner copia o link e manda por WhatsApp.
 */
export async function sendReviewForFeedback(
  clinicId: string,
  reviewId: string,
): Promise<{ token: string; url: string; expiresAt: string }> {
  await assertOwnerSession();

  const excerpts = await loadDraftExcerpts(clinicId, reviewId);
  if (!excerpts) throw new Error("Rodada não encontrada ou não editável.");
  if (excerpts.length < MIN_EXCERPTS_PER_REVIEW) {
    throw new Error(
      `Adicione ao menos ${MIN_EXCERPTS_PER_REVIEW} trechos antes de enviar.`,
    );
  }

  const { token, hash } = generateAccessToken();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + CONVERSATION_REVIEW_LINK_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  // Escopo por clinicId da rota + status draft: não sobrescreve uma rodada já
  // enviada nem de outra clínica.
  const updated = await db
    .update(conversationReviews)
    .set({
      status: "sent",
      accessTokenHash: hash,
      sentAt: now,
      expiresAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.organizationId, clinicId),
        eq(conversationReviews.status, "draft"),
      ),
    )
    .returning({ id: conversationReviews.id });

  if (updated.length === 0) {
    throw new Error("Rodada não encontrada ou já enviada.");
  }

  revalidateReviewPaths(clinicId, reviewId);

  return {
    token,
    url: `${appBaseUrl()}/conversas/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Expira manualmente uma rodada em rascunho ou enviada (descarta o rascunho /
 * invalida o link). Terminal — a rodada fica só no histórico.
 */
export async function expireReview(
  clinicId: string,
  reviewId: string,
): Promise<void> {
  await assertOwnerSession();

  const updated = await db
    .update(conversationReviews)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.organizationId, clinicId),
        inArray(conversationReviews.status, ["draft", "sent"]),
      ),
    )
    .returning({ id: conversationReviews.id });

  if (updated.length === 0) {
    throw new Error("Rodada não encontrada ou já encerrada.");
  }

  revalidateReviewPaths(clinicId, reviewId);
}
