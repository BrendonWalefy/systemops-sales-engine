// Thin adapter: normaliza payload Z-API e delega ao ConversationOrchestrator.
// Toda a lógica de negócio, agenda e IA está no Orchestrator.

import { NextRequest, NextResponse } from "next/server";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

export const dynamic = "force-dynamic";

let orchestrator: ConversationOrchestrator | null = null;
function getOrchestrator() {
  if (!orchestrator) orchestrator = new ConversationOrchestrator();
  return orchestrator;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => null)) as ZApiInboundPayload | null;
  if (!body) return new NextResponse("Bad Request", { status: 400 });

  // Ignora mensagens de grupo, status e mensagens enviadas pelo próprio bot
  if (body.isGroupMsg || body.isStatusReply || body.fromMe) {
    return new NextResponse("OK", { status: 200 });
  }

  // Ignora mensagens sem texto
  if (!body.text?.message) {
    return new NextResponse("OK", { status: 200 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) {
    console.error("[ZApi] PILOT_CLINIC_ID is not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  try {
    // Verifica se auto-reply está habilitado para esta clínica
    const clinicRow = await db
      .select({ autoReplyEnabled: clinics.autoReplyEnabled })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1);

    if (clinicRow.length > 0 && !clinicRow[0].autoReplyEnabled) {
      return new NextResponse("OK", { status: 200 });
    }

    await getOrchestrator().handle({
      clinicId,
      phone: body.phone,
      messageText: body.text.message,
      messageId: body.messageId,
      senderName: body.senderName || undefined,
      timestamp: body.momment ? new Date(body.momment) : new Date(),
    });

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("[ZApi] Webhook error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
