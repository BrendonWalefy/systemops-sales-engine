"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { clinicTreatmentsTag } from "@/lib/cache-tags";

const repo = new DrizzleTreatmentRepository();

export type ActionState = { success: boolean; error?: string } | null;

function parseOptionalCents(raw: FormDataEntryValue | null): number | null {
  if (!raw || String(raw).trim() === "") return null;
  const val = parseFloat(String(raw));
  if (isNaN(val) || val < 0) return null;
  return Math.round(val * 100);
}

export async function createTreatment(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const name = (formData.get("name") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);

  if (!name || isNaN(durationMinutes) || durationMinutes < 5) {
    return { success: false, error: "Preencha todos os campos corretamente." };
  }

  const priceCents = parseOptionalCents(formData.get("priceCents"));

  await repo.create({
    clinicId,
    name,
    durationMinutes,
    description: null,
    requiresEvaluationFirst: false,
    triggerTemplate: null,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents,
    minPriceCents: null,
    maxPriceCents: null,
  });
  revalidatePath("/app/settings/playbook");
  revalidateTag(clinicTreatmentsTag(clinicId), "max");
  return { success: true };
}

export async function updateTreatment(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  const durationMinutes = parseInt(formData.get("durationMinutes") as string, 10);

  if (!id || !name || isNaN(durationMinutes) || durationMinutes < 5) {
    return { success: false, error: "Dados inválidos." };
  }

  const useRange = formData.get("useRange") === "1";
  let priceCents: number | null = null;
  let minPriceCents: number | null = null;
  let maxPriceCents: number | null = null;

  if (useRange) {
    minPriceCents = parseOptionalCents(formData.get("minPriceCents"));
    maxPriceCents = parseOptionalCents(formData.get("maxPriceCents"));
  } else {
    priceCents = parseOptionalCents(formData.get("priceCents"));
  }

  await repo.update(id, { name, durationMinutes, priceCents, minPriceCents, maxPriceCents });
  revalidatePath("/app/settings/playbook");
  revalidateTag(clinicTreatmentsTag(clinicId), "max");
  return { success: true };
}

export async function deleteTreatment(formData: FormData): Promise<void> {
  const clinicId = await requireSessionClinicId();
  const id = formData.get("id") as string;
  if (!id) return;

  await repo.delete(id);
  revalidatePath("/app/settings/playbook");
  revalidateTag(clinicTreatmentsTag(clinicId), "max");
}
