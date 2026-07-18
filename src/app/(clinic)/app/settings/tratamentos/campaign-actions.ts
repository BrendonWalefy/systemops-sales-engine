"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { priceCampaigns, treatments } from "@/infrastructure/db/schema";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { clinicTreatmentsTag } from "@/lib/cache-tags";

export type ActionState = { success: boolean; error?: string } | null;

function parseOptionalCents(raw: FormDataEntryValue | null): number | null {
  if (!raw || String(raw).trim() === "") return null;
  const val = parseFloat(String(raw));
  if (isNaN(val) || val < 0) return null;
  return Math.round(val * 100);
}

function parseOptionalDate(raw: FormDataEntryValue | null, endOfDay: boolean): Date | null {
  const value = raw ? String(raw).trim() : "";
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return isNaN(date.getTime()) ? null : date;
}

async function rejectQuantityPackageCampaign(
  clinicId: string,
  treatmentId: string,
): Promise<ActionState> {
  const [treatment] = await db
    .select({ quantityPrices: treatments.quantityPrices })
    .from(treatments)
    .where(and(eq(treatments.id, treatmentId), eq(treatments.clinicId, clinicId)))
    .limit(1);

  if (!treatment) return { success: false, error: "Tratamento não encontrado." };
  if ((treatment.quantityPrices?.length ?? 0) > 0) {
    return {
      success: false,
      error: "Campanhas promocionais não suportam pacotes por quantidade. Atualize a tabela de pacotes fechados.",
    };
  }
  return null;
}

export async function createPriceCampaign(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const treatmentId = formData.get("treatmentId") as string;
  const name = (formData.get("name") as string)?.trim();

  if (!treatmentId || !name) {
    return { success: false, error: "Dê um nome para a campanha." };
  }

  const packageError = await rejectQuantityPackageCampaign(clinicId, treatmentId);
  if (packageError) return packageError;

  const useRange = formData.get("useRange") === "1";
  const priceCents = useRange ? null : parseOptionalCents(formData.get("priceCents"));
  const minPriceCents = useRange ? parseOptionalCents(formData.get("minPriceCents")) : null;
  const maxPriceCents = useRange ? parseOptionalCents(formData.get("maxPriceCents")) : null;

  if (priceCents == null && minPriceCents == null) {
    return { success: false, error: "Informe o valor promocional." };
  }

  await db.insert(priceCampaigns).values({
    clinicId,
    treatmentId,
    name,
    priceCents,
    minPriceCents,
    maxPriceCents,
    priceKind: formData.get("priceKind") === "fixed" ? "fixed" : "from",
    startsAt: parseOptionalDate(formData.get("startsAt"), false),
    endsAt: parseOptionalDate(formData.get("endsAt"), true),
    isActive: true,
  });

  revalidatePath("/app/settings/playbook");
  revalidateTag(clinicTreatmentsTag(clinicId), "max");
  return { success: true };
}

export async function updatePriceCampaign(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const clinicId = await requireSessionClinicId();
  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();
  if (!id || !name) {
    return { success: false, error: "Dados inválidos." };
  }

  const treatmentId = formData.get("treatmentId") as string;
  if (!treatmentId) return { success: false, error: "Tratamento não informado." };
  const packageError = await rejectQuantityPackageCampaign(clinicId, treatmentId);
  if (packageError) return packageError;

  const useRange = formData.get("useRange") === "1";
  const priceCents = useRange ? null : parseOptionalCents(formData.get("priceCents"));
  const minPriceCents = useRange ? parseOptionalCents(formData.get("minPriceCents")) : null;
  const maxPriceCents = useRange ? parseOptionalCents(formData.get("maxPriceCents")) : null;

  if (priceCents == null && minPriceCents == null) {
    return { success: false, error: "Informe o valor promocional." };
  }

  await db
    .update(priceCampaigns)
    .set({
      name,
      priceCents,
      minPriceCents,
      maxPriceCents,
      priceKind: formData.get("priceKind") === "fixed" ? "fixed" : "from",
      startsAt: parseOptionalDate(formData.get("startsAt"), false),
      endsAt: parseOptionalDate(formData.get("endsAt"), true),
      updatedAt: new Date(),
    })
    .where(and(eq(priceCampaigns.id, id), eq(priceCampaigns.clinicId, clinicId)));

  revalidatePath("/app/settings/playbook");
  revalidateTag(clinicTreatmentsTag(clinicId), "max");
  return { success: true };
}

export async function togglePriceCampaign(formData: FormData): Promise<void> {
  const clinicId = await requireSessionClinicId();
  const id = formData.get("id") as string;
  const isActive = formData.get("isActive") === "1";
  if (!id) return;

  if (isActive) {
    const [campaign] = await db
      .select({ treatmentId: priceCampaigns.treatmentId })
      .from(priceCampaigns)
      .where(and(eq(priceCampaigns.id, id), eq(priceCampaigns.clinicId, clinicId)))
      .limit(1);
    if (campaign && (await rejectQuantityPackageCampaign(clinicId, campaign.treatmentId))) return;
  }

  await db
    .update(priceCampaigns)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(priceCampaigns.id, id), eq(priceCampaigns.clinicId, clinicId)));

  revalidatePath("/app/settings/playbook");
  revalidateTag(clinicTreatmentsTag(clinicId), "max");
}

export async function deletePriceCampaign(formData: FormData): Promise<void> {
  const clinicId = await requireSessionClinicId();
  const id = formData.get("id") as string;
  if (!id) return;

  await db
    .delete(priceCampaigns)
    .where(and(eq(priceCampaigns.id, id), eq(priceCampaigns.clinicId, clinicId)));

  revalidatePath("/app/settings/playbook");
  revalidateTag(clinicTreatmentsTag(clinicId), "max");
}
