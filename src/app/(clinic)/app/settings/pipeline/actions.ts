"use server";
import { revalidatePath } from "next/cache";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import type { PipelineStep } from "@/domain/entities/treatment";

const repo = new DrizzleTreatmentRepository();

export async function savePipelineSteps(
  treatmentId: string,
  steps: PipelineStep[],
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSessionClinicId();
    await repo.update(treatmentId, { pipelineSteps: steps.length > 0 ? steps : null });
    revalidatePath("/app/settings/pipeline");
    revalidatePath(`/app/settings/pipeline/${treatmentId}`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}
