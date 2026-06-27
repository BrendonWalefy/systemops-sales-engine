import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";

export const dynamic = "force-dynamic";

function serializeDate(value: Date | null): string {
  return value ? value.toISOString() : "";
}

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
    .select({ id: conversations.id, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, clinicId)))
    .limit(1);

  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Every message append also updates this row. This keeps the steady-state
  // version check to one tenant-scoped indexed lookup.
  const version = serializeDate(conversation.updatedAt);

  return NextResponse.json(
    { version },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
