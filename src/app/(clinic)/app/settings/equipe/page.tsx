export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getSessionMemberProfile, canEditPrices } from "@/application/tenancy/member-role";
import { EquipeClient } from "./EquipeClient";
import { getCachedEquipeData } from "../server-data";

export default async function EquipePage() {
  const clinicId = await requireSessionClinicId();
  const memberProfile = await getSessionMemberProfile(clinicId);

  if (!memberProfile || !canEditPrices(memberProfile)) {
    redirect("/app/dashboard");
  }

  const { members, professionals } = await getCachedEquipeData(clinicId);

  return (
    <EquipeClient
      members={members.map((m) => ({
        id: m.id,
        email: m.email,
        role: m.role as string,
        professionalId: m.professionalId ?? null,
        avatarUrl: m.avatarUrl ?? null,
      }))}
      professionals={professionals}
    />
  );
}
