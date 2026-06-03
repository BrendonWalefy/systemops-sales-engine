import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { resolveActiveEditorialConfig } from "@/application/config/editorial-config";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { clinics } from "@/infrastructure/db/schema";
import { DrizzleFollowUpRepository } from "@/infrastructure/repositories/drizzle-follow-up-repository";
import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";
import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";
import { ResponseComposer } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";

export const dynamic = "force-dynamic";

type ClinicResult = { clinicId: string; dispatched: number; failed: number; total: number };

async function processClinic(clinicId: string): Promise<ClinicResult | null> {
  const clinic = await db.query.clinics.findFirst({ where: eq(clinics.id, clinicId) });
  if (!clinic) return null;

  const editorial = await resolveActiveEditorialConfig(clinicId);
  const channelConfig = resolveChannelConfig(clinic);

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
          specialty: editorial?.specialty ?? clinic.specialty,
          toneOfVoice: editorial?.toneOfVoice ?? null,
          playbook: editorial?.playbookText ?? null,
          commercialPolicy: editorial?.commercialPolicy ?? null,
        },
        leadName: lead.name,
        timezone,
        isFirstMessage: true,
      });

      await sendTextMessage(lead.phone, composed.text, channelConfig);

      await followUpRepository.save({ ...followUp, status: "done", completedAt: now, updatedAt: now });
      await leadRepository.save({ ...lead, status: "in_conversation", updatedAt: now });

      dispatched++;
    } catch (err) {
      console.error("[FollowUpDispatcher] Failed for follow-up:", followUp.id, err);
      failed++;
    }
  }

  return { clinicId, dispatched, failed, total: dueFollowUps.length };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Roda para TODAS as clínicas, não só a piloto.
  const clinicIds = await listAllClinicIds();
  const results: ClinicResult[] = [];
  for (const id of clinicIds) {
    const r = await processClinic(id);
    if (r) results.push(r);
  }

  const dispatched = results.reduce((a, r) => a + r.dispatched, 0);
  const failed = results.reduce((a, r) => a + r.failed, 0);
  console.log(`[FollowUpDispatcher] clinics=${results.length} dispatched=${dispatched} failed=${failed}`);
  return NextResponse.json({ clinics: results.length, dispatched, failed, perClinic: results });
}
