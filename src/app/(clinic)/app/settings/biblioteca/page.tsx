export const dynamic = "force-dynamic";

import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleMediaAssetRepository } from "@/infrastructure/repositories/drizzle-media-asset-repository";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import { BibliotecaClient } from "./BibliotecaClient";

const mediaAssetRepo = new DrizzleMediaAssetRepository();
const treatmentRepo = new DrizzleTreatmentRepository();

export default async function BibliotecaPage() {
  const clinicId = await requireSessionClinicId();

  const [assets, treatments] = await Promise.all([
    mediaAssetRepo.listByClinic(clinicId),
    treatmentRepo.listByClinic(clinicId),
  ]);

  return (
    <BibliotecaClient
      assets={assets.map((a) => ({
        id: a.id,
        title: a.title,
        url: a.url,
        type: a.type,
        folder: a.folder,
        treatmentId: a.treatmentId,
      }))}
      treatments={treatments.map((t) => ({ id: t.id, name: t.name }))}
    />
  );
}
