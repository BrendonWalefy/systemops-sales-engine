import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads } from "@/infrastructure/db/schema";
import { INBOX_PAGE_SIZE, decodeInboxCursor, encodeInboxCursor } from "./inbox-cursor";

export async function listClinicConversations(params: {
  clinicId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const limit = params.limit ?? INBOX_PAGE_SIZE;
  const cursor = decodeInboxCursor(params.cursor ?? null);

  // NULLS LAST no DESC: uma conversa sem mensagem fica no fim da lista.
  // O cursor precisa do mesmo tratamento, senão a paginação pula linhas.
  const keyset = cursor
    ? cursor.lastMessageAt
      ? or(
          lt(conversations.lastMessageAt, cursor.lastMessageAt),
          and(eq(conversations.lastMessageAt, cursor.lastMessageAt), lt(conversations.id, cursor.id)),
          sql`${conversations.lastMessageAt} is null`,
        )
      : and(sql`${conversations.lastMessageAt} is null`, lt(conversations.id, cursor.id))
    : undefined;

  const rows = await db
    .select({
      convId: conversations.id,
      leadId: leads.id,
      lastMessageAt: conversations.lastMessageAt,
      needsAttention: conversations.needsAttention,
      attentionReason: conversations.attentionReason,
      aiPaused: conversations.aiPaused,
      conversationCategory: conversations.category,
      takeoverExpiresAt: conversations.takeoverExpiresAt,
      lastReadAt: conversations.lastReadAt,
      leadName: leads.name,
      leadPhone: leads.phone,
      leadStatus: leads.status,
      leadTemperature: leads.temperature,
      leadTreatmentInterest: leads.treatmentInterest,
      leadProfilePicUrl: leads.profilePicUrl,
      leadUpdatedAt: leads.updatedAt,
      conversationUpdatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .where(keyset ? and(eq(conversations.clinicId, params.clinicId), keyset) : eq(conversations.clinicId, params.clinicId))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);

  return {
    rows: page,
    nextCursor: rows.length > limit && last ? encodeInboxCursor({ lastMessageAt: last.lastMessageAt, id: last.convId }) : null,
  };
}

export type InboxConversationRow = Awaited<ReturnType<typeof listClinicConversations>>["rows"][number];
