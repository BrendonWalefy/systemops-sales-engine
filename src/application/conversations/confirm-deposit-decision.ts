import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, messages, organizations } from "@/infrastructure/db/schema";
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
import type { DepositProofDecision } from "@/application/conversations/deposit-proof-review";

export type ConfirmDepositDecisionResult =
  | { ok: true; action: DepositProofDecision; leadName: string | null }
  | { ok: false; status: 404 | 409 | 422 | 500; error: string; reason?: string };

export async function confirmDepositDecision(params: {
  conversationId: string;
  clinicId: string;
  action: DepositProofDecision;
}): Promise<ConfirmDepositDecisionResult> {
  const [conv] = await db
    .select({
      leadId: conversations.leadId,
      clinicId: conversations.clinicId,
      externalThreadId: conversations.externalThreadId,
    })
    .from(conversations)
    .where(eq(conversations.id, params.conversationId))
    .limit(1);

  if (!conv || conv.clinicId !== params.clinicId) {
    return { ok: false, status: 404, error: "Conversa não encontrada" };
  }

  const stateMachine = new ConversationStateMachine();
  const reservationService = new SlotReservationService();
  const depositState = await stateMachine.getDepositState(params.conversationId);
  if (!depositState) {
    return { ok: false, status: 409, error: "Nenhum sinal pendente nesta conversa" };
  }
  const payload = depositState.payload;

  const [clinic] = await db.select().from(organizations).where(eq(organizations.id, conv.clinicId)).limit(1);
  if (!clinic) return { ok: false, status: 404, error: "Clínica não encontrada" };
  const [lead] = await db.select().from(leads).where(eq(leads.id, conv.leadId)).limit(1);
  if (!lead) return { ok: false, status: 404, error: "Lead não encontrado" };

  if (params.action === "reject") {
    if (payload.reservationId) await reservationService.release(payload.reservationId);
    await stateMachine.invalidate(params.conversationId);
    await db
      .update(conversations)
      .set({
        aiPaused: true,
        takeoverExpiresAt: null,
        needsAttention: true,
        attentionReason: "Comprovante de sinal não localizado — atendimento manual necessário",
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, params.conversationId));
    return { ok: true, action: "reject", leadName: lead.name };
  }

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
    origin: "deposit_flow",
  });

  if (!result.success) {
    return {
      ok: false,
      status: result.reason === "slot_taken" ? 409 : 500,
      error: result.reason === "slot_taken" ? "Horário não disponível" : "Erro ao criar agendamento",
      reason: result.reason,
    };
  }

  const existing = await apptRepo.findAllActiveByLeadId(lead.id);
  for (const appt of existing) {
    if (appt.startsAt.getTime() === startsAt.getTime()) continue;
    await bookingService.cancel({ lead, appointment: appt }).catch(() => {});
  }

  await stateMachine.transition(params.conversationId, "idle");
  await db
    .update(conversations)
    .set({
      aiPaused: false,
      takeoverExpiresAt: null,
      needsAttention: false,
      attentionReason: null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, params.conversationId));

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
    conversationId: params.conversationId,
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
    }
  }

  return { ok: true, action: "confirm", leadName: lead.name };
}
