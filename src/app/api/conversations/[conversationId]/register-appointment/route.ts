import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics, conversations, leads } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { resolveCalendarGateway } from "@/infrastructure/adapters/calendar/resolve-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { BookingService } from "@/core/scheduling/BookingService";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { cancelPendingFollowUps } from "@/application/use-cases/leads/cancel-pending-follow-ups";
import { type TtsConfig, DEFAULT_TTS_CONFIG } from "@/domain/entities/tts-config";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId } = await params;

  let body: {
    date: string;          // "YYYY-MM-DD"
    time: string;          // "HH:MM"
    durationMinutes?: number;
    calendarEventId?: string;
    calendarEventUrl?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }

  if (!body.date || !body.time) {
    return NextResponse.json({ error: "date e time são obrigatórios" }, { status: 400 });
  }

  try {
    // Tenancy: a conversa precisa pertencer à clínica da sessão.
    const [conv] = await db
      .select({ leadId: conversations.leadId, clinicId: conversations.clinicId })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
      .limit(1);

    if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

    const [clinic] = await db
      .select()
      .from(clinics)
      .where(eq(clinics.id, conv.clinicId ?? ""))
      .limit(1);

    if (!clinic) return NextResponse.json({ error: "Clínica não encontrada" }, { status: 404 });

    const [lead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, conv.leadId))
      .limit(1);

    if (!lead) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

    const timezone = new ClinicTimezone(clinic.timezone);
    const durationMinutes = body.durationMinutes ?? clinic.defaultAppointmentDurationMinutes ?? 60;

    const [year, month, day] = body.date.split("-").map(Number);
    const [hour, minute] = body.time.split(":").map(Number);
    const startsAt = timezone.fromLocalParts(year, month - 1, day, hour, minute);
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

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
    const bookingService = new BookingService(gateway, apptRepo, leadRepo, undefined, followUpRepo);

    const conflicts = await apptRepo.findByPeriod(clinic.id, startsAt, endsAt);
    const hasConflict = conflicts.some(
      (appt) => (appt.status === "scheduled" || appt.status === "confirmed") && appt.leadId !== lead.id,
    );
    if (hasConflict) {
      return NextResponse.json({ error: "Horário não disponível", reason: "slot_taken" }, { status: 409 });
    }

    // Cancela qualquer agendamento ativo anterior do lead nesta clínica
    const existingAppointments = await apptRepo.findAllActiveByLeadId(lead.id);
    for (const existing of existingAppointments) {
      const cancelResult = await bookingService.cancel({ lead, appointment: existing });
      if (!cancelResult.success) {
        return NextResponse.json({ error: cancelResult.reason ?? "Falha ao cancelar agendamento anterior" }, { status: 500 });
      }
    }

    const now = new Date();

    if (body.calendarEventId) {
      await apptRepo.save({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        leadId: lead.id,
        professionalId: null,
        roomId: null,
        calendarEventId: body.calendarEventId,
        calendarEventUrl: body.calendarEventUrl ?? null,
        startsAt,
        endsAt,
        status: "scheduled",
        source: "app",
        reminderSentAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await cancelPendingFollowUps({
        leadId: lead.id,
        followUpRepository: followUpRepo,
      });
    } else {
      const result = await bookingService.book({
        clinic: {
          id: clinic.id,
          name: clinic.name,
          specialty: clinic.specialty,
          city: clinic.city,
          address: clinic.address,
          timezone: clinic.timezone,
          conversationExperience: clinic.conversationExperience,
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
          voiceResponseEnabled: clinic.voiceResponseEnabled ?? false,
          ttsConfig: (clinic.ttsConfig as TtsConfig | null) ?? DEFAULT_TTS_CONFIG,
          createdAt: clinic.createdAt,
          updatedAt: clinic.updatedAt,
        },
        lead,
        startsAt,
        endsAt,
      });

      if (!result.success) {
        const statusCode = result.reason === "slot_taken" ? 409 : 500;
        const message =
          result.reason === "slot_taken"
            ? "Horário não disponível"
            : "Erro ao criar agendamento";
        return NextResponse.json({ error: message, reason: result.reason }, { status: statusCode });
      }
    }

    const newTemperature = (lead.temperature === "hot" || lead.temperature === "warm")
      ? lead.temperature
      : "warm";
    await leadRepo.save({
      ...lead,
      status: "appointment_scheduled",
      temperature: newTemperature,
      updatedAt: now,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[register-appointment]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
