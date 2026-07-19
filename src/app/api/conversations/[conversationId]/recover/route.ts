import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, messages } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";

export const dynamic = "force-dynamic";
// O replay roda classificação + composição LLM inline (a entrega sai pelo
// outbox/sender-worker) — 60s cobre a latência da composição.
export const maxDuration = 60;

// J1 (mapeamento 18/07): a recuperação de lead parado saía de um mini-LLM à
// parte — mensagem genérica, sem persona, sem conduzir; depois a recepcionista
// "se apresentava" de novo, criando duas personas na mesma conversa. Este
// endpoint retoma pelo PRÓPRIO motor: reprocessa a última mensagem de texto do
// lead como se tivesse acabado de chegar — saudação, persona, pipeline e ritmo
// idênticos ao fluxo orgânico.
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
      externalThreadId: conversations.externalThreadId,
    })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Conversa nao encontrada" }, { status: 404 });

  const [lead] = await db
    .select({ id: leads.id, phone: leads.phone, whatsappLid: leads.whatsappLid })
    .from(leads)
    .where(eq(leads.id, conv.leadId))
    .limit(1);
  if (!lead) return NextResponse.json({ error: "Lead nao encontrado" }, { status: 404 });

  const channelAddress =
    resolveWhatsAppChannelAddress({ phone: lead.phone, whatsappLid: lead.whatsappLid }) ??
    conv.externalThreadId;
  if (!channelAddress) {
    return NextResponse.json({ error: "Identidade WhatsApp do lead nao encontrada" }, { status: 422 });
  }

  const history = await db
    .select({
      id: messages.id,
      author: messages.author,
      body: messages.body,
      mediaType: messages.mediaType,
      sentAt: messages.sentAt,
      externalId: messages.externalId,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sentAt));

  const lastLeadText = [...history]
    .reverse()
    .find((m) => m.author === "lead" && !m.mediaType && m.body.trim().length > 0);
  if (!lastLeadText) {
    return NextResponse.json(
      { error: "Sem mensagem de texto do lead para retomar — use a mensagem manual" },
      { status: 409 },
    );
  }

  const now = new Date();
  await db
    .update(conversations)
    .set({ aiPaused: false, takeoverExpiresAt: null, aiResumedAt: now, updatedAt: now })
    .where(eq(conversations.id, conversationId));

  try {
    const orchestrator = new ConversationOrchestrator();
    const result = await orchestrator.handle({
      clinicId: conv.clinicId,
      phone: lead.phone ?? channelAddress,
      whatsappLid: lead.whatsappLid,
      messageText: lastLeadText.body,
      messageId: lastLeadText.externalId ?? lastLeadText.id,
      timestamp: lastLeadText.sentAt,
      replyEnabled: true,
      replayOfMessageDbId: lastLeadText.id,
    });

    // Idempotência: o cron de recuperação ignora este lead por 24h.
    await db.execute(sql`
      INSERT INTO follow_ups (id, clinic_id, lead_id, due_at, status, reason, completed_at, created_at, updated_at)
      VALUES (gen_random_uuid(), ${conv.clinicId}, ${lead.id}, NOW(), 'done', 'recovery_campaign', NOW(), NOW(), NOW())
      ON CONFLICT DO NOTHING
    `).catch((err) => console.error("[Recover] follow-up bookkeeping falhou:", err));

    return NextResponse.json({ ok: true, replied: result.replied });
  } catch (err) {
    console.error("[Recover] Replay falhou:", err);
    return NextResponse.json({ error: "Falha ao retomar pelo motor — use a mensagem manual" }, { status: 502 });
  }
}
