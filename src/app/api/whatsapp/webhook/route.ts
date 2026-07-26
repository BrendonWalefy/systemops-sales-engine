// Thin adapter: valida o envelope Meta, persiste o payload bruto e enfileira o processamento.
import { resolveClinicByMetaPhoneNumberId } from "@/application/tenancy/resolve-clinic";
// GET: verificação do webhook Meta. POST: mensagens recebidas.

import { NextRequest, NextResponse } from "next/server";
import { parseMetaInboundTextMessage } from "@/infrastructure/adapters/channels/whatsapp/meta-webhook-content";
import { persistInboundEventAndEnqueue } from "@/application/whatsapp/persist-inbound-event";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";

export const dynamic = "force-dynamic";

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

  const message = parseMetaInboundTextMessage(body);
  // Status updates e tipos ainda não suportados não entram na jornada.
  if (!message) {
    return new NextResponse("OK", { status: 200 });
  }

  const clinicId = await resolveClinicByMetaPhoneNumberId(message.phoneNumberId);
  if (!clinicId) {
    console.error("[Meta] nenhuma clínica para phone_number_id", message.phoneNumberId);
    return new NextResponse("Internal Server Error", { status: 500 });
  }

  try {
    await persistInboundEventAndEnqueue({
      clinicId,
      provider: "meta_cloud_api",
      providerMessageId: message.messageId,
      conversationKey: message.phone,
      payload: body,
      normalizedText: message.messageText,
      mediaType: null,
      dedupeKey: `meta:${message.phoneNumberId}:${message.messageId}`,
      receivedAt: message.receivedAt,
    }, {
      inboundEventStore: new DrizzleInboundEventStore(),
      jobQueue: new DrizzleJobQueue(),
    });

    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    // Meta repete o webhook; insert e enqueue são idempotentes.
    console.error("[Meta] Webhook enqueue error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
