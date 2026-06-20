export const dynamic = "force-dynamic";

import "./profissionais.css";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { redirect } from "next/navigation";
import { ProfissionaisClient } from "./ProfissionaisClient";
import { getCachedProfessionals } from "../server-data";

export default async function ProfissionaisPage() {
  const clinicId = await getSessionClinicId();
  if (!clinicId) redirect("/login");
  const professionals = await getCachedProfessionals(clinicId);

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
