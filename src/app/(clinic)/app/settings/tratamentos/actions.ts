"use server";
import { revalidatePath } from "next/cache";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";

const repo = new DrizzleTreatmentRepository();

export type ActionState = { success: boolean; error?: string } | null;

export async function createTreatment(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const name = (formData.get("name") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);

  if (!name || isNaN(durationMinutes) || durationMinutes < 5) {
    return { success: false, error: "Preencha todos os campos corretamente." };
  }

  await repo.create({ clinicId, name, durationMinutes, description: null, commonObjections: [], requiresEvaluationFirst: false });
  revalidatePath("/app/settings/playbook");
  return { success: true };
}

export async function updateTreatment(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);

  if (!id || !name || isNaN(durationMinutes) || durationMinutes < 5) {
    return { success: false, error: "Dados inválidos." };
  }

  await repo.update(id, { name, durationMinutes });
  revalidatePath("/app/settings/playbook");
  return { success: true };
}

export async function deleteTreatment(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  if (!id) return;

  await repo.delete(id);
  revalidatePath("/app/settings/playbook");
}
