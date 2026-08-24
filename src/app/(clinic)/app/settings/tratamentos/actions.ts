"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { clinicTreatmentsTag } from "@/lib/cache-tags";

const repo = new DrizzleTreatmentRepository();

export type ActionState = { success: boolean; error?: string } | null;

/**
 * Teto de um fato de texto divulgável no plano autorizado da V2. Acima disso o
 * turno inteiro cairia na frase determinística, sem ninguém saber por quê.
 */
const MAX_DESCRIPTION_LENGTH = 240;

function parseDescription(raw: FormDataEntryValue | null): string | null {
  const text = String(raw ?? "").trim();
  if (text.length === 0) return null;
  return text.slice(0, MAX_DESCRIPTION_LENGTH);
}

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
    description: parseDescription(formData.get("description")),
    requiresEvaluationFirst: false,
    keywordMatchEnabled: true,
    aliases: [],
    isAesthetic: false,
    pipelineSteps: null,
    priceCents,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: false,
    priceKind: "from",
    priceUnit: null,
    priceDeductible: false,
    quantityPrices: null,
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

  const patch: Parameters<typeof repo.update>[1] = {
    name,
    durationMinutes,
    priceCents,
    minPriceCents,
    maxPriceCents,
  };

  // Mesmo padrão de marcador de presença do preço: a descrição só é tocada por
  // um formulário que a envia, para editar nome/duração em outra aba não apagar
  // o texto que explica o procedimento.
  if (formData.get("descriptionPresent") === "1") {
    patch.description = parseDescription(formData.get("description"));
  }

  // Item 3: flags de derivação de preço só são tocadas quando o formulário as
  // envia (marcador priceFlagsPresent). Assim editar o tratamento por outra aba
  // (nome/duração) não zera as flags configuradas na aba Financeiro.
  if (formData.get("priceFlagsPresent") === "1") {
    patch.priceQuotableInChat = formData.get("priceQuotableInChat") === "1";
    patch.priceKind = formData.get("priceKind") === "fixed" ? "fixed" : "from";
    const unit = (formData.get("priceUnit") as string | null)?.trim();
    patch.priceUnit = unit ? unit : null;
    patch.priceDeductible = formData.get("priceDeductible") === "1";
  }

  await repo.update(id, patch);
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
