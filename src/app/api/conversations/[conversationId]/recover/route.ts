import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { requireV2ConversationHandoff } from "@/application/conversation-v2/v2-conversation-handoff";
import { DrizzleV2ConversationHandoffStore } from "@/infrastructure/repositories/drizzle-v2-conversation-handoff-store";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Recuperação manual não reprocessa histórico: sem uma nova authority inbound,
// qualquer replay seria uma entrada lateral no runtime. A conversa fica em
// handoff durável para continuação humana até existir uma capability V2 própria.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;
  const [conv] = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
      clinicId: conversations.clinicId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });

  const now = new Date();
  try {
    await requireV2ConversationHandoff(new DrizzleV2ConversationHandoffStore(), {
      clinicId: conv.clinicId,
      conversationId: conv.id,
      reason: "v2_manual_recovery_requires_human",
      now,
    });

    // Idempotência: o cron de recuperação ignora este lead por 24h.
    await db.execute(sql`
      INSERT INTO follow_ups (id, clinic_id, lead_id, due_at, status, reason, completed_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${conv.clinicId}, ${conv.leadId}, NOW(), 'done', 'recovery_campaign', NOW(), NOW(), NOW())
      ON CONFLICT DO NOTHING
    `).catch((err) => console.error("[Recover] follow-up bookkeeping falhou:", err));

    return NextResponse.json({ ok: true, mode: "safe_handoff", replied: false });
  } catch (err) {
    console.error("[Recover] Handoff V2 falhou:", err);
    return NextResponse.json({ error: "Falha ao registrar atenção humana" }, { status: 502 });
  }
}
