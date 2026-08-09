export const dynamic = "force-dynamic";

import "./agenda-calendar.css";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getSessionMemberProfile } from "@/application/tenancy/member-role";
import { redirect } from "next/navigation";
import { AgendaClient } from "./AgendaClient";
import { getCachedProfessionals, getCachedTreatmentsForAgenda } from "@/app/(clinic)/app/settings/server-data";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { resolveSegmentVocab } from "@/application/onboarding/segment-vocab";
import { getActivePriceCampaignsByTreatment, effectiveBookableValueCents } from "@/application/config/price-campaigns";
import { measureServerOperation } from "@/infrastructure/observability/performance-logger";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const clinicId = await getSessionClinicId();
  if (!clinicId) redirect("/login");

  const [professionals, clinicRow, treatments, activeCampaigns, memberProfile] = await measureServerOperation(
    {
      clinicId,
      surface: "agenda",
      operation: "agenda_bootstrap",
    },
    () => Promise.all([
      getCachedProfessionals(clinicId),
      db
        .select({
          timezone: organizations.timezone,
          serviceNoun: organizations.serviceNoun,
          segment: organizations.segment,
          defaultAppointmentDurationMinutes: organizations.defaultAppointmentDurationMinutes,
        })
        .from(organizations)
        .where(eq(organizations.id, clinicId))
        .limit(1),
      getCachedTreatmentsForAgenda(clinicId),
      getActivePriceCampaignsByTreatment(clinicId),
      getSessionMemberProfile(clinicId),
    ]),
  );
  const timezone = clinicRow[0]?.timezone ?? "America/Sao_Paulo";
  const serviceNoun = clinicRow[0]?.serviceNoun ?? "tratamento";
  const businessNoun = resolveSegmentVocab(clinicRow[0]?.segment ?? "dental").businessNoun;
  const defaultDurationMinutes = clinicRow[0]?.defaultAppointmentDurationMinutes ?? 60;
  const memberRole = memberProfile?.memberRole ?? "org_admin";

  const now = new Date();
  const from = new Date(now.getTime() - 14 * 24 * 60 * 60_000);
  const to = new Date(now.getTime() + 28 * 24 * 60 * 60_000);

  return (
    <AgendaClient
      professionals={professionals.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        specialty: p.specialty,
        isActive: p.isActive,
        workSchedule: p.workSchedule ?? null,
      }))}
      treatments={treatments.map((t) => ({
        id: t.id,
        name: t.name,
        durationMinutes: t.durationMinutes,
        // Preço efetivo (campanha ativa sobrepõe a lista) — mesma regra da IA e do dashboard.
        priceCents: effectiveBookableValueCents(t, activeCampaigns.get(t.id) ?? null),
        deductible: t.priceDeductible,
      }))}
      memberRole={memberRole}
      serviceNoun={serviceNoun}
      businessNoun={businessNoun}
      initialFrom={from.toISOString()}
      initialTo={to.toISOString()}
      openNew={params?.new === "1"}
      timezone={timezone}
      defaultDurationMinutes={defaultDurationMinutes}
    />
  );
}
