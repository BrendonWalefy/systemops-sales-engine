export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { db } from "@/infrastructure/db/client";
import { playbookVersions } from "@/infrastructure/db/schema";
import { PipelineEditorClient } from "./pipeline-editor-client";

type MediaItem = { id: string; title: string; url: string; type: "video" | "image" };

export default async function PipelineEditorPage({ params }: { params: Promise<{ treatmentId: string }> }) {
  const { treatmentId } = await params;
  const clinicId = await requireSessionClinicId();

  const [treatment, activeVersion] = await Promise.all([
    new DrizzleTreatmentRepository().listByClinic(clinicId).then((list) => list.find((t) => t.id === treatmentId)),
    db.query.playbookVersions.findFirst({
      where: and(eq(playbookVersions.clinicId, clinicId), eq(playbookVersions.status, "active")),
      columns: { mediaLibrary: true },
    }),
  ]);

  if (!treatment) notFound();

  const mediaLibrary = (activeVersion?.mediaLibrary as MediaItem[] | null) ?? [];

  return (
    <PipelineEditorClient
      treatment={{
        id: treatment.id,
        name: treatment.name,
        pipelineSteps: treatment.pipelineSteps,
      }}
      mediaLibrary={mediaLibrary}
    />
  );
}
