"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getSessionMemberProfile, canEditPrices } from "@/application/tenancy/member-role";
import { db } from "@/infrastructure/db/client";
import { clinicMembers } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/password";
import { clinicEquipeTag } from "@/lib/cache-tags";

export type EquipeActionState = { success: boolean; error?: string } | null;

async function requireAdmin() {
  const clinicId = await requireSessionClinicId();
  const profile = await getSessionMemberProfile(clinicId);
  if (!profile || !canEditPrices(profile)) {
    throw new Error("Sem permissão");
  }
  return clinicId;
}

export async function addMember(
  prevState: EquipeActionState,
  formData: FormData,
): Promise<EquipeActionState> {
  let clinicId: string;
  try {
    clinicId = await requireAdmin();
  } catch {
    return { success: false, error: "Sem permissão para gerenciar equipe." };
  }

  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const role = (formData.get("role") as string) ?? "receptionist";
  const professionalId = (formData.get("professionalId") as string) || null;
  const password = (formData.get("password") as string) || null;
  const displayName = ((formData.get("displayName") as string) ?? "").trim() || null;

  if (!email || !["org_admin", "professional", "receptionist"].includes(role)) {
    return { success: false, error: "Dados inválidos." };
  }

  const passwordHash = password ? await hashPassword(password) : null;

  try {
    await db
      .insert(clinicMembers)
      .values({
        clinicId,
        email,
        role: role as "org_admin" | "professional" | "receptionist",
        professionalId,
        passwordHash,
        displayName,
      })
      .onConflictDoUpdate({
        target: [clinicMembers.email, clinicMembers.clinicId],
        set: {
          role: role as "org_admin" | "professional" | "receptionist",
          professionalId,
          displayName,
          ...(passwordHash && { passwordHash }),
        },
      });
    revalidatePath("/app/settings/equipe");
    revalidateTag(clinicEquipeTag(clinicId), "max");
    return { success: true };
  } catch (err) {
    console.error("[addMember]", err);
    return { success: false, error: "Erro ao salvar membro." };
  }
}

// Atualiza APENAS o nome de exibição de um membro (saudação do dashboard).
// Não altera papel, senha, profissional vinculado nem avatar.
export async function setMemberDisplayName(formData: FormData): Promise<void> {
  let clinicId: string;
  try {
    clinicId = await requireAdmin();
  } catch {
    return;
  }

  const memberId = formData.get("memberId") as string;
  if (!memberId) return;
  const displayName = ((formData.get("displayName") as string) ?? "").trim() || null;

  await db
    .update(clinicMembers)
    .set({ displayName })
    .where(and(eq(clinicMembers.id, memberId), eq(clinicMembers.clinicId, clinicId)));

  revalidatePath("/app/settings/equipe");
  revalidateTag(clinicEquipeTag(clinicId), "max");
}

export async function removeMember(formData: FormData): Promise<void> {
  let clinicId: string;
  try {
    clinicId = await requireAdmin();
  } catch {
    return;
  }

  const memberId = formData.get("memberId") as string;
  if (!memberId) return;

  await db
    .delete(clinicMembers)
    .where(and(eq(clinicMembers.id, memberId), eq(clinicMembers.clinicId, clinicId)));

  revalidatePath("/app/settings/equipe");
  revalidateTag(clinicEquipeTag(clinicId), "max");
}
