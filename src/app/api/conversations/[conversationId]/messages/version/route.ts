import { NextResponse } from "next/server";
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { conversations, messages } from "@/infrastructure/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, clinicId)))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const [[stats], latestRows] = await Promise.all([
    db
      .select({ total: count() })
      .from(messages)
      .where(eq(messages.conversationId, conversationId)),
    db
      .select({
        id: messages.id,
        sentAt: messages.sentAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.sentAt), desc(messages.createdAt), desc(messages.id))
      .limit(1),
  ]);

  const latest = latestRows[0];
  const version = [
    String(stats?.total ?? 0),
    latest?.id ?? "",
    latest?.sentAt?.toISOString() ?? "",
    latest?.createdAt?.toISOString() ?? "",
  ].join("|");

  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
