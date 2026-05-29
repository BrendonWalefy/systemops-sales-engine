import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) return NextResponse.json({ error: "PILOT_CLINIC_ID not set" }, { status: 500 });

  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return NextResponse.json({ error: "Clinic not found" }, { status: 500 });

  const followUpRepository = new DrizzleFollowUpRepository();
  const leadRepository = new DrizzleLeadRepository();
  const appointmentRepository = new DrizzleAppointmentRepository();
  const composer = new ResponseComposer();
  const timezone = new ClinicTimezone(clinic.timezone);

  const now = new Date();
  const dueFollowUps = await followUpRepository.listDue({ clinicId, now });

  let dispatched = 0;
  let failed = 0;

  for (const followUp of dueFollowUps) {
    try {
      const lead = await leadRepository.findById(followUp.leadId);
      if (!lead?.phone) {
        await followUpRepository.save({ ...followUp, status: "cancelled", updatedAt: now });
        continue;
      }

      const lastAppointment = await appointmentRepository.findByLeadId(followUp.leadId);
      const lastAppointmentLabel = lastAppointment
        ? new Intl.DateTimeFormat("pt-BR", {
            timeZone: clinic.timezone,
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
          }).format(lastAppointment.startsAt)
        : "consulta anterior";

      const composed = await composer.compose({
        actionResult: { type: "reengagement", lastAppointmentLabel },
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
        isFirstMessage: true,
      });

      await sendTextMessage(lead.phone, composed.text);

      await followUpRepository.save({
        ...followUp,
        status: "done",
        completedAt: now,
        updatedAt: now,
      });

      await leadRepository.save({
        ...lead,
        status: "in_conversation",
        updatedAt: now,
      });

      dispatched++;
      console.log(`[FollowUpDispatcher] Dispatched follow-up ${followUp.id} for lead ${lead.id}`);
    } catch (err) {
      console.error("[FollowUpDispatcher] Failed for follow-up:", followUp.id, err);
      failed++;
    }
  }

  console.log(`[FollowUpDispatcher] dispatched=${dispatched} failed=${failed} total=${dueFollowUps.length}`);
  return NextResponse.json({ dispatched, failed, total: dueFollowUps.length });
}
