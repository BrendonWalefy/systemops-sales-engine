export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getSessionMemberProfile, canEditPrices } from "@/application/tenancy/member-role";
import { db } from "@/infrastructure/db/client";
import { clinicMembers, professionals as professionalsTable } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { EquipeClient } from "./EquipeClient";

async function getData() {
  const clinicId = await requireSessionClinicId();
  const memberProfile = await getSessionMemberProfile(clinicId);

  if (!memberProfile || !canEditPrices(memberProfile)) {
    redirect("/app/dashboard");
  }

  const [members, professionals] = await Promise.all([
    db
      .select({
        id: clinicMembers.id,
        email: clinicMembers.email,
        role: clinicMembers.role,
        professionalId: clinicMembers.professionalId,
        avatarUrl: clinicMembers.avatarUrl,
      })
      .from(clinicMembers)
      .where(eq(clinicMembers.clinicId, clinicId)),
    db
      .select({ id: professionalsTable.id, name: professionalsTable.name })
      .from(professionalsTable)
      .where(eq(professionalsTable.clinicId, clinicId)),
  ]);

  return { members, professionals };
}

export default async function EquipePage() {
  const { members, professionals } = await getData();

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
