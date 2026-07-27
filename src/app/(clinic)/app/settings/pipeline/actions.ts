"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import type { PipelineStep } from "@/domain/entities/treatment";
import { clinicTreatmentsTag } from "@/lib/cache-tags";

const repo = new DrizzleTreatmentRepository();

export async function savePipelineSteps(
  treatmentId: string,
  steps: PipelineStep[],
  configuration?: {
    pipelineSourceTreatmentId: string | null;
    pipelineEntryBehavior: "immediate" | "qualify_then_present" | null;
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const clinicId = await requireSessionClinicId();
    const clinicTreatments = await repo.listByClinic(clinicId);
    const treatment = clinicTreatments.find((candidate) => candidate.id === treatmentId);
    if (!treatment) {
      return { success: false, error: "Tratamento não encontrado nesta clínica." };
    }

    const sourceId = configuration
      ? configuration.pipelineSourceTreatmentId
      : treatment.pipelineSourceTreatmentId ?? null;
    const source = sourceId
      ? clinicTreatments.find((candidate) => candidate.id === sourceId)
      : null;
    if (sourceId && (!source || source.id === treatment.id)) {
      return { success: false, error: "Pipeline canônico inválido." };
    }
    if (source?.pipelineSourceTreatmentId) {
      return {
        success: false,
        error: "A fonte precisa ser um tratamento canônico, não outra variante.",
      };
    }
    if (source && !(source.pipelineSteps?.length)) {
      return {
        success: false,
        error: "Configure etapas no tratamento canônico antes de vinculá-lo.",
      };
    }

    await repo.update(treatmentId, {
      // Uma variante nunca mantém uma segunda cópia da jornada.
      pipelineSteps: source ? null : (steps.length > 0 ? steps : null),
      pipelineSourceTreatmentId: source?.id ?? null,
      pipelineEntryBehavior: configuration
        ? configuration.pipelineEntryBehavior
        : treatment.pipelineEntryBehavior ?? null,
    });
    revalidatePath("/app/settings/pipeline");
    revalidatePath(`/app/settings/pipeline/${treatmentId}`);
    revalidateTag(clinicTreatmentsTag(clinicId), "max");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}
