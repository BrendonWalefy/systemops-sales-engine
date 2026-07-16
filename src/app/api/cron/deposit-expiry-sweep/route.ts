import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { db } from "@/infrastructure/db/client";
import { conversationStates, conversations, leads } from "@/infrastructure/db/schema";
import { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import type { DepositFlowPayload } from "@/core/conversation/ConversationStateMachine";
import { buildDepositExpiredMessage } from "@/core/conversation/DepositTemplates";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { enqueueOutboundMessage } from "@/application/jobs/enqueue-outbound-message";
import { DrizzleOutboundMessageStore } from "@/infrastructure/repositories/drizzle-outbound-message-store";
import { DrizzleJobQueue } from "@/infrastructure/repositories/drizzle-job-queue";
import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";
import { DEFAULT_TTS_CONFIG } from "@/domain/entities/tts-config";

export const dynamic = "force-dynamic";

// Guarda de custo — não escaneia holds mais antigos que isto.
const SCAN_WINDOW_MS = 7 * 24 * 60 * 60_000;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const now = new Date();
  const reservationService = new SlotReservationService();
  const stateMachine = new ConversationStateMachine();
  const conversationRepo = new DrizzleConversationRepository();

  // Holds de sinal cujo TTL expirou (state awaiting_deposit_proof + expires_at < agora).
  const expiredRows = await db
    .select({
      id: conversationStates.id,
      conversationId: conversationStates.conversationId,
      payload: conversationStates.payload,
      createdAt: conversationStates.createdAt,
    })
    .from(conversationStates)
    .where(
      and(
        eq(conversationStates.state, "awaiting_deposit_proof"),
        lt(conversationStates.expiresAt, now),
        gt(conversationStates.expiresAt, new Date(now.getTime() - SCAN_WINDOW_MS)),
      ),
    );

  let released = 0;
  for (const row of expiredRows) {
    // Idempotência: só processa se ESTE ainda é o estado mais recente da conversa
    // (nenhuma row mais nova). Se o lead já mandou comprovante ou pediu outro slot,
    // haverá uma row posterior e pulamos.
    const [latest] = await db
      .select({ id: conversationStates.id, state: conversationStates.state })
      .from(conversationStates)
      .where(eq(conversationStates.conversationId, row.conversationId))
      .orderBy(desc(conversationStates.createdAt))
      .limit(1);
    if (!latest || latest.id !== row.id) continue;

    const payload = row.payload as DepositFlowPayload | null;
    if (payload?.reservationId) {
      await reservationService.release(payload.reservationId);
    }
    await stateMachine.invalidate(row.conversationId);

    // Avisa o lead que o horário foi liberado (categoria reminder — é desdobramento de
    // uma ação iniciada pelo lead, não reengajamento; não pode ser suprimida).
    const [conv] = await db
      .select({ clinicId: conversations.clinicId, leadId: conversations.leadId, externalThreadId: conversations.externalThreadId })
      .from(conversations)
      .where(eq(conversations.id, row.conversationId))
      .limit(1);
    if (!conv) continue;
    const [lead] = await db
      .select({ phone: leads.phone, whatsappLid: leads.whatsappLid })
      .from(leads)
      .where(eq(leads.id, conv.leadId))
      .limit(1);
    const channelAddress =
      resolveWhatsAppChannelAddress({ phone: lead?.phone ?? null, whatsappLid: lead?.whatsappLid ?? null }) ??
      conv.externalThreadId;
    if (!channelAddress) {
      released++;
      continue;
    }

    const text = buildDepositExpiredMessage();
    const agentMessageId = randomUUID();
    await conversationRepo.appendMessage({
      id: agentMessageId,
      conversationId: row.conversationId,
      author: "agent",
      body: text,
      sentAt: now,
      externalId: null,
      intent: "reminder",
      deliveryFormat: null,
    });
    await enqueueOutboundMessage(
      {
        clinicId: conv.clinicId,
        conversationId: row.conversationId,
        channel: "whatsapp" as const,
        deliveryKind: "text" as const,
        category: "reminder" as const,
        dedupeKey: `deposit-expired:${row.id}`,
        payload: {
          version: 1 as const,
          kind: "automation" as const,
          to: channelAddress,
          text,
          leadId: conv.leadId,
          conversationId: row.conversationId,
          agentMessageId,
          useVoice: false,
          ttsConfig: DEFAULT_TTS_CONFIG,
        },
      },
      { outboundMessageStore: new DrizzleOutboundMessageStore(), jobQueue: new DrizzleJobQueue() },
    );
    released++;
  }

  return NextResponse.json({ ok: true, released, scanned: expiredRows.length });
}
