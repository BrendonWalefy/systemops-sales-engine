import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { organizations, conversations, leads, messages } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { resolveSegmentVocab } from "@/application/onboarding/segment-vocab";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { BookingService } from "@/core/scheduling/BookingService";
import { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";
import { buildDepositConfirmationMessage } from "@/core/conversation/DepositTemplates";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";

export const dynamic = "force-dynamic";

// Operador valida (ou rejeita) o comprovante do sinal. A IA NUNCA valida comprovante —
// esta é a etapa humana do fluxo de sinal. `confirm` cria o agendamento (reaproveitando
// o hold do lead) e envia a confirmação determinística; `reject` libera o hold e deixa
// o operador assumir a conversa.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;

  let body: { action: "confirm" | "reject" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  if (body.action !== "confirm" && body.action !== "reject") {
    return NextResponse.json({ error: "action deve ser 'confirm' ou 'reject'" }, { status: 400 });
  }

  const [conv] = await db
    .select({ leadId: conversations.leadId, clinicId: conversations.clinicId, externalThreadId: conversations.externalThreadId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

  const stateMachine = new ConversationStateMachine();
  const reservationService = new SlotReservationService();
  const depositState = await stateMachine.getDepositState(conversationId);
  if (!depositState) {
    return NextResponse.json({ error: "Nenhum sinal pendente nesta conversa" }, { status: 409 });
  }
  const payload = depositState.payload;

  const [clinic] = await db.select().from(organizations).where(eq(organizations.id, conv.clinicId)).limit(1);
  if (!clinic) return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });
  const [lead] = await db.select().from(leads).where(eq(leads.id, conv.leadId)).limit(1);
  if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

  // ── Rejeitar: libera o hold; operador assume a conversa manualmente ──
  if (body.action === "reject") {
    if (payload.reservationId) await reservationService.release(payload.reservationId);
    await stateMachine.invalidate(conversationId);
    await db
      .update(conversations)
      .set({ needsAttention: false, attentionReason: null, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));
    return NextResponse.json({ ok: true, action: "reject" });
  }

  // ── Confirmar: cria o agendamento reaproveitando o hold do lead ──
  const timezone = new ClinicTimezone(clinic.timezone);
  const startsAt = new Date(payload.slotStartsAt);
  const endsAt = new Date(payload.slotEndsAt);

  const apptRepo = new DrizzleAppointmentRepository();
  const leadRepo = new DrizzleLeadRepository();
  const followUpRepo = new DrizzleFollowUpRepository();
  const gateway = resolveCalendarGateway({
    clinicId: clinic.id,
    calendarMode: clinic.calendarMode,
    googleCalendarId: clinic.googleCalendarId,
    timezone,
    businessHours: clinic.businessHours,
    postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
  });
  const bookingService = new BookingService(gateway, apptRepo, leadRepo, reservationService, followUpRepo);

  const result = await bookingService.book({
    clinic: {
      id: clinic.id,
      name: clinic.name,
      specialty: clinic.specialty,
      city: clinic.city,
      address: clinic.address,
      timezone: clinic.timezone,
      greetingMessage: clinic.greetingMessage,
      menuItems: clinic.menuItems,
      businessHours: clinic.businessHours,
      googleCalendarId: clinic.googleCalendarId,
      calendarMode: clinic.calendarMode,
      receptionistPhone: clinic.receptionistPhone ?? null,
      takeoverTtlHours: clinic.takeoverTtlHours,
      postAppointmentBufferMinutes: clinic.postAppointmentBufferMinutes,
      defaultAppointmentDurationMinutes: clinic.defaultAppointmentDurationMinutes,
      rateLimitPerHour: clinic.rateLimitPerHour,
      unclearThreshold: clinic.unclearThreshold,
      staleConversationHours: clinic.staleConversationHours,
      slotOfferTtlMinutes: clinic.slotOfferTtlMinutes,
      maxSlotsToOffer: clinic.maxSlotsToOffer,
      slotLookaheadDays: clinic.slotLookaheadDays,
      mediaTakeoverTtlHours: clinic.mediaTakeoverTtlHours ?? null,
      rapidThrottleMs: clinic.rapidThrottleMs,
      messageDebounceMs: clinic.messageDebounceMs ?? null,
      segment: clinic.segment,
      serviceNoun: clinic.serviceNoun,
      bookingNoun: clinic.bookingNoun,
      contactNoun: clinic.contactNoun,
      agentRole: clinic.agentRole,
      businessDescriptor: clinic.businessDescriptor ?? null,
      businessNoun: resolveSegmentVocab(clinic.segment).businessNoun,
      createdAt: clinic.createdAt,
      updatedAt: clinic.updatedAt,
    },
    lead,
    startsAt,
    endsAt,
    treatmentName: payload.treatmentName,
    treatmentId: payload.treatmentId,
    valueCents: payload.valueCents,
    heldReservationId: payload.reservationId,
  });

  if (!result.success) {
    const statusCode = result.reason === "slot_taken" ? 409 : 500;
    const message = result.reason === "slot_taken" ? "Horário não disponível" : "Erro ao criar agendamento";
    return NextResponse.json({ error: message, reason: result.reason }, { status: statusCode });
  }

  // Cancela agendamento ativo anterior do lead (remarcação implícita).
  const existing = await apptRepo.findAllActiveByLeadId(lead.id);
  for (const appt of existing) {
    if (appt.startsAt.getTime() === startsAt.getTime()) continue; // o recém-criado
    await bookingService.cancel({ lead, appointment: appt }).catch(() => {});
  }

  await stateMachine.transition(conversationId, "idle");
  await db
    .update(conversations)
    .set({ needsAttention: false, attentionReason: null, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  // Envia a confirmação determinística ao lead + persiste como mensagem do agente.
  const confirmationText = buildDepositConfirmationMessage(
    {
      address: clinic.address,
      depositConfirmationNotes: clinic.depositConfirmationNotes,
    },
    payload.slotLabel,
  );
  const channelAddress =
    resolveWhatsAppChannelAddress({ phone: lead.phone, whatsappLid: lead.whatsappLid }) ??
    conv.externalThreadId;
  const msgId = randomUUID();
  await db.insert(messages).values({
    id: msgId,
    conversationId,
    author: "agent",
    body: confirmationText,
    sentAt: new Date(),
    externalId: null,
  });
  if (channelAddress) {
    try {
      const channelConfig = resolveChannelConfig(clinic);
      const zapiMessageId = await sendTextMessage(channelAddress, confirmationText, channelConfig);
      if (zapiMessageId) {
        await db.update(messages).set({ externalId: zapiMessageId }).where(eq(messages.id, msgId));
      }
    } catch (err) {
      console.error("[ConfirmDeposit] WhatsApp send failed:", err);
      // Agendamento já criado — não falha a request por causa do envio.
    }
  }

  return NextResponse.json({ ok: true, action: "confirm" });
}
