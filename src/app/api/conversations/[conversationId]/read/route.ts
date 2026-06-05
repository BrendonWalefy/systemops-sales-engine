import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { conversations } from "@/infrastructure/db/schema";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;
  const now = new Date();

  const [updated] = await db
    .update(conversations)
    .set({ lastReadAt: now, updatedAt: now })
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, clinicId)))
    .returning({ id: conversations.id });

  if (!updated) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${conversationId}`);

  return NextResponse.json({ ok: true, lastReadAt: now.toISOString() });
}
