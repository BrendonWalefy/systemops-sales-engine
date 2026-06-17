import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { clinics } from "@/infrastructure/db/schema";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { inferReceptionistNameFromGreeting } from "@/core/intelligence/receptionist-name";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";
import { resolveWhatsAppChannelAddress } from "@/core/whatsapp/WhatsAppContactIdentity";
import { shouldSendAutomatedClinicOutbound } from "@/application/automation/clinic-automation-policy";
import { requireCronAuthorization } from "@/app/api/cron/_auth";

export const dynamic = "force-dynamic";

// Janela: consultas que começam entre 20h e 32h a partir de agora.
const WINDOW_START_HOURS = 20;
const WINDOW_END_HOURS = 32;

type ClinicResult = { clinicId: string; sent: number; failed: number; total: number };

async function processClinic(clinicId: string): Promise<ClinicResult | null> {
  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return null;
  if (!shouldSendAutomatedClinicOutbound(clinic)) {
    console.log(`[AppointmentReminder] outbound automatizado pausado para clinic=${clinicId}`);
    return { clinicId, sent: 0, failed: 0, total: 0 };
  }

  const editorial = await resolveActiveEditorialConfig(clinicId);
  const defaultChannelConfig = resolveChannelConfig(clinic);

  const appointmentRepository = new DrizzleAppointmentRepository();
  const leadRepository = new DrizzleLeadRepository();
  const composer = new ResponseComposer();
  const timezone = new ClinicTimezone(clinic.timezone);

  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_START_HOURS * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + WINDOW_END_HOURS * 60 * 60 * 1000);

  const dueAppointments = await appointmentRepository.findDueReminders({ clinicId, windowStart, windowEnd });

  let sent = 0;
  let failed = 0;

  for (const appointment of dueAppointments) {
    try {
      const lead = await leadRepository.findById(appointment.leadId);
      if (!lead) continue;
      const channelAddress = resolveWhatsAppChannelAddress({
        phone: lead.phone,
        whatsappLid: lead.whatsappLid,
      });
      if (!channelAddress) continue;
      const channelConfig = defaultChannelConfig;

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
          specialty: editorial?.specialty ?? clinic.specialty,
          toneOfVoice: editorial?.toneOfVoice ?? null,
          playbook: editorial?.playbookText ?? null,
          commercialPolicy: editorial?.commercialPolicy ?? null,
          receptionistName: inferReceptionistNameFromGreeting(clinic.greetingMessage) ?? undefined,
        },
        leadName: lead.name,
        timezone,
        isFirstMessage: false,
      });

      await sendTextMessage(channelAddress, composed.text, channelConfig);
      await appointmentRepository.save({ ...appointment, reminderSentAt: now, updatedAt: now });
      sent++;
    } catch (err) {
      console.error("[AppointmentReminder] Failed for appointment:", appointment.id, err);
      failed++;
    }
  }

  return { clinicId, sent, failed, total: dueAppointments.length };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const clinicIds = await listAllClinicIds();
  const results: ClinicResult[] = [];
  for (const id of clinicIds) {
    const r = await processClinic(id);
    if (r) results.push(r);
  }

  const sent = results.reduce((a, r) => a + r.sent, 0);
  const failed = results.reduce((a, r) => a + r.failed, 0);
  console.log(`[AppointmentReminder] clinics=${results.length} sent=${sent} failed=${failed}`);
  return NextResponse.json({ clinics: results.length, sent, failed, perClinic: results });
}
