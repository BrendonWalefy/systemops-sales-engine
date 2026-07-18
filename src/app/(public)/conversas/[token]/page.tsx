/**
 * Página pública de revisão de conversas pelo cliente
 * (docs/product/revisao-conversas-plano.md, seção 6).
 *
 * Sem login, sem cookie, sem `clinicId`/`reviewId` na URL: a rodada é
 * resolvida apenas pelo hash sha256 do token (rate limit dispensado na v1 —
 * mesma justificativa do ADR-002, apêndice G: 256 bits de entropia tornam
 * brute-force inviável). O responsável da clínica abre o link pelo celular e
 * vê trechos reais de conversas do shadow mode renderizados como chat, com
 * espaço de feedback opcional por trecho.
 */

import { db } from "@/infrastructure/db/client";
import { conversationReviews, organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import {
  hashAccessToken,
  resolvePublicDocState,
} from "@/application/public-link/access-token";
import type { ConversationExcerpt } from "@/domain/entities/conversation-review";
import { toPublicExcerpt } from "@/domain/entities/conversation-review";
import { ConversationReviewForm } from "./conversas-ui";
import { StateScreen } from "../../state-screen";

export const dynamic = "force-dynamic";

export default async function ConversasPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const result = await db
    .select({
      review: conversationReviews,
      organizationName: organizations.name,
    })
    .from(conversationReviews)
    .innerJoin(organizations, eq(conversationReviews.organizationId, organizations.id))
    .where(eq(conversationReviews.accessTokenHash, hashAccessToken(token)))
    .limit(1);

  const review = result[0]?.review;
  const clinicName = result[0]?.organizationName;

  const state = resolvePublicDocState(review, new Date());

  if (state === "expired") {
    return (
      <StateScreen
        emoji="⌛"
        title="Este link expirou"
        message="O prazo para revisar esta rodada terminou. Fale com a equipe da SystemOps para receber um novo link."
      />
    );
  }
  if (state === "answered") {
    return (
      <StateScreen
        emoji="✅"
        title="Revisão concluída"
        message="Obrigado! Seus comentários já chegaram pra gente. Vamos ajustar a assistente e te mostrar a próxima rodada."
      />
    );
  }
  if (state !== "valid" || !review) {
    return (
      <StateScreen
        emoji="🔗"
        title="Link inválido"
        message="Não encontramos esta revisão de conversas. Confira se copiou o link completo ou peça um novo à equipe da SystemOps."
      />
    );
  }

  const excerpts = (review.excerpts ?? []) as ConversationExcerpt[];
  // `sourceConversationId` é rastreabilidade interna e nunca deve chegar ao
  // payload público (Apêndice G do plano) — a props boundary React Server→
  // Client serializa tudo que passa por aqui, então a sanitização é neste
  // limite, não na UI.
  const publicExcerpts = excerpts.map(toPublicExcerpt);

  return (
    <ConversationReviewForm token={token} clinicName={clinicName} excerpts={publicExcerpts} />
  );
}
