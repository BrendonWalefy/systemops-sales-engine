import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql, notInArray } from "drizzle-orm";
import { requireCronAuthorization } from "@/app/api/cron/_auth";
import { db } from "@/infrastructure/db/client";
import { appointments, clinics, leads } from "@/infrastructure/db/schema";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { NotifyClinicOperators } from "@/application/use-cases/notifications/notify-clinic-operators";
import { DrizzlePushSubscriptionRepository } from "@/infrastructure/repositories/drizzle-push-subscription-repository";
import { WebPushGateway } from "@/infrastructure/adapters/push/web-push-gateway";

export const dynamic = "force-dynamic";

const notifier = new NotifyClinicOperators(
  new DrizzlePushSubscriptionRepository(),
  new WebPushGateway(),
);

async function processClinic(clinicId: string): Promise<number> {
  const [clinic] = await db
    .select({ timezone: clinics.timezone, name: clinics.name })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  if (!clinic) return 0;

  const tz = clinic.timezone ?? "America/Sao_Paulo";

  // Busca agendamentos de amanhã no fuso da clínica
  const tomorrowAppts = await db
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      leadName: leads.name,
      leadPhone: leads.phone,
    })
    .from(appointments)
    .leftJoin(leads, eq(appointments.leadId, leads.id))
    .where(
      and(
        eq(appointments.clinicId, clinicId),
        notInArray(appointments.status, ["cancelled"]),
        sql`(${appointments.startsAt} AT TIME ZONE ${tz})::date = ((NOW() AT TIME ZONE ${tz})::date + 1)`,
      ),
    )
    .orderBy(appointments.startsAt);

  if (tomorrowAppts.length === 0) return 0;

  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const lines = tomorrowAppts
    .map((a) => `• ${fmt.format(a.startsAt)} — ${a.leadName ?? a.leadPhone ?? "Paciente"}`)
    .join("\n");

  await notifier.execute(clinicId, {
    title: `📅 Agenda de amanhã · ${clinic.name}`,
    body: `${tomorrowAppts.length} consulta${tomorrowAppts.length !== 1 ? "s" : ""} agendada${tomorrowAppts.length !== 1 ? "s" : ""}:\n${lines}`,
    url: "/app/agenda",
  });

  console.log(
    `[AppointmentReminderStaff] clinic=${clinicId} amanhã=${tomorrowAppts.length} consultas`,
  );

  return tomorrowAppts.length;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const clinicIds = await listAllClinicIds();
  const results = await Promise.allSettled(clinicIds.map((id) => processClinic(id)));

  let total = 0;
  for (const r of results) {
    if (r.status === "fulfilled") total += r.value;
    else console.error("[AppointmentReminderStaff] processClinic failed:", r.reason);
  }

  return NextResponse.json({ clinics: clinicIds.length, totalAppointments: total });
}
