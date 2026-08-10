import { and, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads } from "@/infrastructure/db/schema";
import { INBOX_PAGE_SIZE, decodeInboxCursor, encodeInboxCursor } from "./inbox-cursor";

export async function listClinicConversations(params: {
  clinicId: string;
  cursor?: string | null;
  limit?: number;
  // Restringe a página às conversas de uma aba já decidida pelo índice de
  // segmentação (Task 4b). Sem isso, mantém o comportamento clinic-wide
  // original — os testes existentes cobrem esse caminho.
  ids?: string[];
}) {
  if (params.ids && params.ids.length === 0) {
    return { rows: [], nextCursor: null };
  }

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

  const idsFilter = params.ids ? inArray(conversations.id, params.ids) : undefined;

  // Mesma forma de where quando não há ids/cursor extras: preserva a query
  // exercitada pelos testes existentes (eq isolado, sem `and` de 1 elemento).
  const conditions = [eq(conversations.clinicId, params.clinicId), keyset, idsFilter].filter(
    (condition): condition is SQL => condition !== undefined,
  );
  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

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
    .where(whereClause)
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
