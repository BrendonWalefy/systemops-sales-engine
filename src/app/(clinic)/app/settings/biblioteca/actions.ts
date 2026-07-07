"use server";

import { revalidatePath } from "next/cache";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleMediaAssetRepository } from "@/infrastructure/repositories/drizzle-media-asset-repository";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { VercelBlobStorageGateway } from "@/infrastructure/adapters/storage/vercel-blob-storage-gateway";

const mediaAssetRepo = new DrizzleMediaAssetRepository();
const treatmentRepo = new DrizzleTreatmentRepository();

export async function renameMediaAsset(id: string, title: string): Promise<{ error?: string }> {
  const clinicId = await requireSessionClinicId();
  const trimmed = title.trim();
  if (!trimmed) return { error: "Título não pode ser vazio." };

  const updated = await mediaAssetRepo.update(id, clinicId, { title: trimmed });
  if (!updated) return { error: "Mídia não encontrada." };

  revalidatePath("/app/settings/biblioteca");
  return {};
}

export async function updateMediaAssetFolder(id: string, folder: string | null): Promise<{ error?: string }> {
  const clinicId = await requireSessionClinicId();
  const updated = await mediaAssetRepo.update(id, clinicId, { folder: folder?.trim() || null });
  if (!updated) return { error: "Mídia não encontrada." };

  revalidatePath("/app/settings/biblioteca");
  return {};
}

// treatmentId null = mídia geral (visível/enviável em qualquer procedimento).
// Ver isolamento entre procedimentos em ConversationOrchestrator.resolveOutboundParts.
export async function assignMediaAssetTreatment(
  id: string,
  treatmentId: string | null,
): Promise<{ error?: string }> {
  const clinicId = await requireSessionClinicId();

  if (treatmentId) {
    const clinicTreatments = await treatmentRepo.listByClinic(clinicId);
    if (!clinicTreatments.some((t) => t.id === treatmentId)) {
      return { error: "Procedimento inválido para esta clínica." };
    }
  }

  const updated = await mediaAssetRepo.update(id, clinicId, { treatmentId });
  if (!updated) return { error: "Mídia não encontrada." };

  revalidatePath("/app/settings/biblioteca");
  return {};
}

export async function deleteMediaAsset(id: string): Promise<{ error?: string }> {
  const clinicId = await requireSessionClinicId();

  const asset = await mediaAssetRepo.findById(clinicId, id);
  if (!asset) return { error: "Mídia não encontrada." };

  const usage = await mediaAssetRepo.findUsage(id, clinicId);
  if (usage.playbookVersions.length > 0 || usage.treatments.length > 0) {
    const parts = [
      ...usage.playbookVersions.map((v) => `Playbook "${v.name}"`),
      ...usage.treatments.map((t) => `Pipeline de "${t.name}"`),
    ];
    return { error: `Mídia em uso: ${parts.join(", ")}. Remova essas referências antes de excluir.` };
  }

  try {
    await new VercelBlobStorageGateway().delete(asset.url);
  } catch (err) {
    console.warn(`[Biblioteca] Falha ao apagar blob de ${id}:`, err);
  }
  await mediaAssetRepo.delete(id, clinicId);

  revalidatePath("/app/settings/biblioteca");
  return {};
}
