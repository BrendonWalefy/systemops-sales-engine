import { NextRequest, NextResponse } from "next/server";
import { db } from "@/infrastructure/db/client";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { conversations, messages } from "@/infrastructure/db/schema";
import { and, asc, desc, eq, gt, lt, or } from "drizzle-orm";
import { attachInboxPreviews } from "@/application/messaging/attach-inbox-previews";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;

  // Tenancy: a conversa precisa pertencer à clínica da sessão — sem este
  // filtro qualquer usuário logado lia mensagens de qualquer clínica.
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, clinicId)))
    .limit(1);

  if (!conv) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const afterId = req.nextUrl.searchParams.get("after");
  const beforeId = req.nextUrl.searchParams.get("before");

  // Load messages older than a given ID (for "load previous" pagination)
  if (beforeId) {
    const [beforeMessage] = await db
      .select({ id: messages.id, sentAt: messages.sentAt, createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.id, beforeId)))
      .limit(1);

    const msgs = await db
      .select()
      .from(messages)
      .where(
        beforeMessage
          ? and(
              eq(messages.conversationId, conversationId),
              or(
                lt(messages.sentAt, beforeMessage.sentAt),
                and(eq(messages.sentAt, beforeMessage.sentAt), lt(messages.createdAt, beforeMessage.createdAt)),
              ),
            )
          : eq(messages.conversationId, conversationId),
      )
      .orderBy(desc(messages.sentAt), desc(messages.createdAt))
      .limit(60)
      .then((rows) => rows.reverse());

    return NextResponse.json({ messages: await attachInboxPreviews(msgs) });
  }

  if (!afterId) {
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.sentAt), asc(messages.createdAt), asc(messages.id));

    return NextResponse.json({ messages: await attachInboxPreviews(msgs) });
  }

  const [afterMessage] = await db
    .select({
      id: messages.id,
      sentAt: messages.sentAt,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.id, afterId)))
    .limit(1);

  const msgs = await db
    .select()
    .from(messages)
    .where(
      afterMessage
        ? and(
            eq(messages.conversationId, conversationId),
            or(
              gt(messages.sentAt, afterMessage.sentAt),
              and(eq(messages.sentAt, afterMessage.sentAt), gt(messages.createdAt, afterMessage.createdAt)),
              and(
                eq(messages.sentAt, afterMessage.sentAt),
                eq(messages.createdAt, afterMessage.createdAt),
                gt(messages.id, afterMessage.id),
              ),
            ),
          )
        : eq(messages.conversationId, conversationId),
    )
    .orderBy(asc(messages.sentAt), asc(messages.createdAt), asc(messages.id));

  return NextResponse.json({ messages: await attachInboxPreviews(msgs) });
}
