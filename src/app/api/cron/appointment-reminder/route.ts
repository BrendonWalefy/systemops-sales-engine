import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";

export const dynamic = "force-dynamic";

// Janela: consultas que começam entre 20h e 32h a partir de agora.
// Com cron às 13h UTC (10h BRT), captura consultas do dia seguinte entre ~9h e 21h BRT.
const WINDOW_START_HOURS = 20;
const WINDOW_END_HOURS = 32;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return NextResponse.json({ error: "PILOT_CLINIC_ID not set" }, { status: 500 });

  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 500 });

  const appointmentRepository = new DrizzleAppointmentRepository();
  const leadRepository = new DrizzleLeadRepository();
  const composer = new ResponseComposer();
  const timezone = new ClinicTimezone(clinic.timezone);

  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_START_HOURS * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + WINDOW_END_HOURS * 60 * 60 * 1000);

  const dueAppointments = await appointmentRepository.findDueReminders({
    clinicId,
    windowStart,
    windowEnd,
  });

  let sent = 0;
  let failed = 0;

  for (const appointment of dueAppointments) {
    try {
      const lead = await leadRepository.findById(appointment.leadId);
      if (!lead?.phone) continue;

      const appointmentLabel = new Intl.DateTimeFormat("pt-BR", {
        timeZone: clinic.timezone,
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(appointment.startsAt);

      const composed = await composer.compose({
        actionResult: { type: "appointment_reminder", appointmentLabel },
        conversationHistory: [],
        clinic: {
          name: clinic.name,
          specialty: clinic.specialty,
          toneOfVoice: clinic.toneOfVoice,
          playbook: clinic.playbook,
          commercialPolicy: clinic.commercialPolicy,
        },
        leadName: lead.name,
        timezone,
        isFirstMessage: false,
      });

      await sendTextMessage(lead.phone, composed.text);

      await appointmentRepository.save({
        ...appointment,
        reminderSentAt: now,
        updatedAt: now,
      });

      sent++;
      console.log(`[AppointmentReminder] Sent reminder for appointment ${appointment.id} → lead ${lead.id}`);
    } catch (err) {
      console.error("[AppointmentReminder] Failed for appointment:", appointment.id, err);
      failed++;
    }
  }

  console.log(`[AppointmentReminder] sent=${sent} failed=${failed} total=${dueAppointments.length}`);
  return NextResponse.json({ sent, failed, total: dueAppointments.length });
}
