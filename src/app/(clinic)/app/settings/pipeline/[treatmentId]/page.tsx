export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { DrizzleMediaAssetRepository } from "@/infrastructure/repositories/drizzle-media-asset-repository";
import { PipelineEditorClient } from "./pipeline-editor-client";

const mediaAssetRepo = new DrizzleMediaAssetRepository();

export default async function PipelineEditorPage({ params }: { params: Promise<{ treatmentId: string }> }) {
  const { treatmentId } = await params;
  const clinicId = await requireSessionClinicId();

  const [clinicTreatments, allMediaAssets] = await Promise.all([
    new DrizzleTreatmentRepository().listByClinic(clinicId),
    mediaAssetRepo.listByClinic(clinicId),
  ]);
  const treatment = clinicTreatments.find((candidate) => candidate.id === treatmentId);

  if (!treatment) notFound();
  const source = treatment.pipelineSourceTreatmentId
    ? clinicTreatments.find((candidate) => candidate.id === treatment.pipelineSourceTreatmentId) ?? null
    : null;
  const effectivePipelineTreatment = source?.pipelineSteps?.length ? source : treatment;
  const allowedTreatmentIds = new Set([treatment.id, effectivePipelineTreatment.id]);
  const mediaAssets = allMediaAssets.filter(
    (asset) => asset.treatmentId === null || allowedTreatmentIds.has(asset.treatmentId),
  );

  return (
    <PipelineEditorClient
      treatment={{
        id: treatment.id,
        name: treatment.name,
        pipelineSteps: effectivePipelineTreatment.pipelineSteps,
        ownPipelineSteps: treatment.pipelineSteps,
        pipelineSourceTreatmentId: treatment.pipelineSourceTreatmentId ?? null,
        pipelineEntryBehavior: treatment.pipelineEntryBehavior ?? null,
      }}
      pipelineSources={clinicTreatments
        .filter((candidate) =>
          candidate.id !== treatment.id &&
          !candidate.pipelineSourceTreatmentId &&
          (candidate.pipelineSteps?.length ?? 0) > 0,
        )
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          pipelineSteps: candidate.pipelineSteps ?? [],
        }))}
      mediaLibrary={mediaAssets
        .filter((a) => a.type === "video" || a.type === "image")
        .map((a) => ({ id: a.id, title: a.title, url: a.url, type: a.type as "video" | "image", treatmentId: a.treatmentId }))}
    />
  );
}
