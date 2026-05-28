"use server";
import { revalidatePath } from "next/cache";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";

const repo = new DrizzleTreatmentRepository();

export async function createTreatment(formData: FormData) {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const name = (formData.get("name") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);

  if (!name || isNaN(durationMinutes) || durationMinutes < 5) return;

  await repo.create({ clinicId, name, durationMinutes, description: null, commonObjections: [] });
  revalidatePath("/app/settings/tratamentos");
}

export async function updateTreatment(formData: FormData) {
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);

  if (!id || !name || isNaN(durationMinutes) || durationMinutes < 5) return;

  await repo.update(id, { name, durationMinutes });
  revalidatePath("/app/settings/tratamentos");
}

export async function deleteTreatment(formData: FormData) {
  const id = formData.get("id") as string;
  if (!id) return;

  await repo.delete(id);
  revalidatePath("/app/settings/tratamentos");
}
