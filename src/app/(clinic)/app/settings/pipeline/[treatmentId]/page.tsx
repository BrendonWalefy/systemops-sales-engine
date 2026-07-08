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

  const [treatment, mediaAssets] = await Promise.all([
    new DrizzleTreatmentRepository().listByClinic(clinicId).then((list) => list.find((t) => t.id === treatmentId)),
    // Isolamento entre procedimentos: só oferece mídia geral + a deste tratamento.
    mediaAssetRepo.listByClinicAndTreatment(clinicId, treatmentId),
  ]);

  if (!treatment) notFound();

  return (
    <PipelineEditorClient
      treatment={{
        id: treatment.id,
        name: treatment.name,
        pipelineSteps: treatment.pipelineSteps,
      }}
      mediaLibrary={mediaAssets
        .filter((a) => a.type === "video" || a.type === "image")
        .map((a) => ({ id: a.id, title: a.title, url: a.url, type: a.type as "video" | "image", treatmentId: a.treatmentId }))}
    />
  );
}
