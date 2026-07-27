// Thin adapter: valida o envelope Meta, persiste o payload bruto e enfileira o processamento.
import { resolveMetaWebhookTenant } from "@/application/tenancy/resolve-clinic";
// GET: verificação do webhook Meta. POST: mensagens recebidas.

import { NextRequest, NextResponse } from "next/server";
import { parseMetaInboundTextMessage } from "@/infrastructure/adapters/channels/whatsapp/meta-webhook-content";
import { persistInboundEventAndEnqueue } from "@/application/whatsapp/persist-inbound-event";
import { DrizzleInboundEventStore } from "@/infrastructure/repositories/drizzle-inbound-event-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import {
  extractMetaPhoneNumberId,
  verifyMetaWebhookSignature,
} from "@/application/whatsapp/meta-webhook-auth";
import { decryptCredentialNullable } from "@/infrastructure/crypto/credential-vault";

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
  const rawBody = await request.text();
  const body = parseJson(rawBody);
  if (!body) return new NextResponse("Bad Request", { status: 400 });

  const phoneNumberId = extractMetaPhoneNumberId(body);
  if (!phoneNumberId) return new NextResponse("Bad Request", { status: 400 });
  const tenant = await resolveMetaWebhookTenant(phoneNumberId);
  if (!tenant) {
    console.error("[Meta] nenhuma clínica para phone_number_id", phoneNumberId);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
  const appSecret = decryptCredentialNullable(tenant.encryptedAppSecret);
  if (!appSecret) {
    console.error("[Meta] app secret ausente para clínica", tenant.clinicId);
    return new NextResponse("Service Unavailable", { status: 503 });
  }
  if (!verifyMetaWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get("x-hub-signature-256"),
    appSecret,
  })) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const message = parseMetaInboundTextMessage(body);
  // Status updates e tipos ainda não suportados não entram na jornada.
  if (!message) {
    return new NextResponse("OK", { status: 200 });
  }

  try {
    await persistInboundEventAndEnqueue({
      clinicId: tenant.clinicId,
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

function parseJson(rawBody: string): unknown | null {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}
