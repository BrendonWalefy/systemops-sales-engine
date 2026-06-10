export const dynamic = "force-dynamic";

import "./agenda-calendar.css";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { AgendaClient } from "./AgendaClient";
import { DrizzleProfessionalRepository } from "@/infrastructure/repositories/drizzle-professional-repository";

export default async function AgendaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const clinicId = (await getSessionClinicId()) ?? "";
  const professionals = clinicId
    ? await new DrizzleProfessionalRepository().listByClinic(clinicId)
    : [];

  const now = new Date();
  const from = new Date(now.getTime() - 14 * 24 * 60 * 60_000); // -2 semanas
  const to = new Date(now.getTime() + 28 * 24 * 60 * 60_000);   // +4 semanas

  return (
    <AgendaClient
      professionals={professionals.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        specialty: p.specialty,
        isActive: p.isActive,
      }))}
      initialFrom={from.toISOString()}
      initialTo={to.toISOString()}
      openNew={params?.new === "1"}
    />
  );
}
