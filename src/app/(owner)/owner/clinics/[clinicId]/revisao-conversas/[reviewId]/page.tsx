export const dynamic = "force-dynamic";

/**
 * Subpágina de curadoria de uma rodada de Revisão de Conversas
 * (docs/product/revisao-conversas-plano.md, seções 5 e 7).
 *
 * Rascunho: picker de conversas do shadow (mensagens `simulated` nos últimos
 * 21 dias, máx. 30 conversas) + lista de trechos com reordenação ▲▼.
 * Enviada/respondida/expirada: leitura dos trechos e do feedback do cliente.
 *
 * MULTI-TENANT: a rodada é resolvida por (reviewId, clinicId da rota); as
 * conversas elegíveis são filtradas por `conversations.clinicId`. Mutações
 * ficam nas server actions (assertOwnerSession).
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { db } from "@/infrastructure/db/client";
import {
  conversationReviews,
  conversations,
  messages,
  leads,
  organizations,
} from "@/infrastructure/db/schema";
import { eq, and, gte, desc, inArray } from "drizzle-orm";
import type { ConversationExcerpt } from "@/domain/entities/conversation-review";
import { ReviewWorkbench, type PickerConversation } from "./revisao-conversas-ui";

/** Janela do picker (seção 5 do plano): conversas do shadow dos últimos 21 dias. */
const PICKER_LOOKBACK_DAYS = 21;
/** Máximo de conversas listadas no picker (seção 5 do plano). */
const MAX_PICKER_CONVERSATIONS = 30;
/** Cap defensivo de mensagens carregadas por conversa no picker. */
const MAX_PICKER_MESSAGES_PER_CONV = 100;

type Params = Promise<{ clinicId: string; reviewId: string }>;

async function loadPickerConversations(clinicId: string): Promise<PickerConversation[]> {
  const since = new Date(Date.now() - PICKER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Conversas com ao menos uma resposta da IA em shadow no período — é o
  // material da revisão: como a assistente teria respondido de verdade.
  const convsWithShadow = db
    .selectDistinct({ conversationId: messages.conversationId })
    .from(messages)
    .where(and(eq(messages.simulated, true), gte(messages.sentAt, since)));

  const eligible = await db
    .select({
      id: conversations.id,
      leadName: leads.name,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .where(
      and(
        eq(conversations.clinicId, clinicId),
        inArray(conversations.id, convsWithShadow),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(MAX_PICKER_CONVERSATIONS);

  if (eligible.length === 0) return [];

  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      author: messages.author,
      body: messages.body,
      mediaType: messages.mediaType,
      deliveryFormat: messages.deliveryFormat,
      sentAt: messages.sentAt,
      simulated: messages.simulated,
    })
    .from(messages)
    .where(inArray(messages.conversationId, eligible.map((c) => c.id)))
    .orderBy(messages.sentAt);

  const byConv = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byConv.get(row.conversationId) ?? [];
    list.push(row);
    byConv.set(row.conversationId, list);
  }

  return eligible.map((conv) => ({
    id: conv.id,
    leadName: conv.leadName,
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    messages: (byConv.get(conv.id) ?? [])
      .slice(-MAX_PICKER_MESSAGES_PER_CONV)
      .map((m) => ({
        id: m.id,
        author: m.author,
        body: m.body,
        mediaType: m.mediaType,
        deliveryFormat: m.deliveryFormat,
        sentAt: m.sentAt.toISOString(),
        simulated: m.simulated,
      })),
  }));
}

export default async function RevisaoConversasPage({ params }: { params: Params }) {
  // Guarda de sessão na própria página (irmãs não têm, mas esta serve mensagens cruas de pacientes pré-anonimização — código novo não replica padrão fraco; finding da auditoria multitenant).
  const store = await cookies();
  const sessionToken = store.get(COOKIE_NAME)?.value;
  const session = sessionToken ? await verifyToken(sessionToken) : null;
  if (!session || session.role !== "owner") redirect("/login");

  const { clinicId, reviewId } = await params;

  const [review, clinic] = await Promise.all([
    db.query.conversationReviews.findFirst({
      where: and(
        eq(conversationReviews.id, reviewId),
        eq(conversationReviews.organizationId, clinicId),
      ),
    }),
    db.query.organizations.findFirst({
      where: eq(organizations.id, clinicId),
      columns: { name: true },
    }),
  ]);

  if (!review || !clinic) notFound();

  const pickerConversations =
    review.status === "draft" ? await loadPickerConversations(clinicId) : [];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 980, display: "grid", gap: 20 }}>
      <div>
        <Link
          href={`/owner/clinics/${clinicId}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", textDecoration: "none" }}
        >
          <ArrowLeft size={14} /> {clinic.name}
        </Link>
        <h1 style={{ margin: "10px 0 0", fontSize: 22, fontWeight: 800 }}>
          Revisão de conversas · {review.title}
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Trechos reais do shadow mode, anonimizados, que o cliente vê como chat e
          comenta antes do go-live.
        </p>
      </div>

      <ReviewWorkbench
        clinicId={clinicId}
        review={{
          id: review.id,
          status: review.status,
          title: review.title,
          excerpts: (review.excerpts ?? []) as ConversationExcerpt[],
          overallComment: review.overallComment,
          sentAt: review.sentAt?.toISOString() ?? null,
          answeredAt: review.answeredAt?.toISOString() ?? null,
          expiresAt: review.expiresAt?.toISOString() ?? null,
        }}
        conversations={pickerConversations}
      />
    </div>
  );
}
