export const dynamic = "force-dynamic";

import "./profissionais.css";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { redirect } from "next/navigation";
import { DrizzleProfessionalRepository } from "@/infrastructure/repositories/drizzle-professional-repository";
import { ProfissionaisClient } from "./ProfissionaisClient";

export default async function ProfissionaisPage() {
  const clinicId = await getSessionClinicId();
  if (!clinicId) redirect("/login");
  const professionals = await new DrizzleProfessionalRepository().listByClinic(clinicId);

  return (
    <ProfissionaisClient
      initialProfessionals={professionals.map((p) => ({
        id: p.id,
        name: p.name,
        specialty: p.specialty,
        color: p.color,
        isActive: p.isActive,
      }))}
    />
  );
}
