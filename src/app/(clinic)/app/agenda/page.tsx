export const dynamic = "force-dynamic";

import "./agenda-calendar.css";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getSessionMemberProfile } from "@/application/tenancy/member-role";
import { redirect } from "next/navigation";
import { AgendaClient } from "./AgendaClient";
import { DrizzleProfessionalRepository } from "@/infrastructure/repositories/drizzle-professional-repository";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const clinicId = await getSessionClinicId();
  if (!clinicId) redirect("/login");

  const [professionals, clinicRow, treatments, memberProfile] = await Promise.all([
    new DrizzleProfessionalRepository().listByClinic(clinicId),
    db
      .select({ timezone: clinics.timezone, serviceNoun: clinics.serviceNoun })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1),
    new DrizzleTreatmentRepository().listByClinic(clinicId),
    getSessionMemberProfile(clinicId),
  ]);
  const timezone = clinicRow[0]?.timezone ?? "America/Sao_Paulo";
  const serviceNoun = clinicRow[0]?.serviceNoun ?? "tratamento";
  const memberRole = memberProfile?.memberRole ?? "clinic_admin";

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
      }))}
      treatments={treatments.map((t) => ({
        id: t.id,
        name: t.name,
        priceCents: t.priceCents,
      }))}
      memberRole={memberRole}
      serviceNoun={serviceNoun}
      initialFrom={from.toISOString()}
      initialTo={to.toISOString()}
      openNew={params?.new === "1"}
      timezone={timezone}
    />
  );
}
