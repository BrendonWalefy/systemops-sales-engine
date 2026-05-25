// Thin adapter: normaliza payload Meta Cloud API e delega ao ConversationOrchestrator.
// GET: verificação do webhook Meta. POST: mensagens recebidas.

import { NextRequest, NextResponse } from "next/server";
import { ConversationOrchestrator } from "@/core/pipeline/ConversationOrchestrator";

export const dynamic = "force-dynamic";

let orchestrator: ConversationOrchestrator | null = null;
function getOrchestrator() {
  if (!orchestrator) orchestrator = new ConversationOrchestrator();
  return orchestrator;
}

// Meta webhook verification
export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// Incoming message from Meta Cloud API
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => null);
  if (!body) return new NextResponse("Bad Request", { status: 400 });

  const messageObj = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  // Ignora não-texto e status updates
  if (!messageObj || messageObj.type !== "text") {
    return new NextResponse("OK", { status: 200 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) {
    console.error("[Meta] PILOT_CLINIC_ID is not set");
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const from: string = messageObj.from;
  const messageText: string = messageObj.text?.body ?? "";
  const messageId: string = messageObj.id;
  const contactName: string | undefined =
    body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ?? undefined;
  const receivedAt = new Date(Number(messageObj.timestamp) * 1000);

  try {
    await getOrchestrator().handle({
      clinicId,
      phone: from,
      messageText,
      messageId,
      senderName: contactName,
      timestamp: receivedAt,
    });

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("[Meta] Webhook error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
