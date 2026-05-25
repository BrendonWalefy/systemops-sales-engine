import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/infrastructure/db/client";
import { messages } from "@/infrastructure/db/schema";
import { eq, asc } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sentAt));

  return NextResponse.json({ messages: msgs });
}
