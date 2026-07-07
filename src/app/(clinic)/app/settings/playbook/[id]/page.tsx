export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { organizations, playbookVersions } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PlaybookEditorClient } from "./editor-client";
import { resolveSegmentVocab } from "@/application/onboarding/segment-vocab";
import { DrizzleMediaAssetRepository } from "@/infrastructure/repositories/drizzle-media-asset-repository";

const mediaAssetRepo = new DrizzleMediaAssetRepository();

export default async function PlaybookEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const clinicId = await requireSessionClinicId();

  const [[version], clinicRow, libraryAssets] = await Promise.all([
    db
      .select()
      .from(playbookVersions)
      .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, clinicId)))
      .limit(1),
    db
      .select({ greetingMessage: organizations.greetingMessage, segment: organizations.segment, bookingNoun: organizations.bookingNoun })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1)
      .then((r) => r[0] ?? null),
    mediaAssetRepo.listByClinic(clinicId),
  ]);

  if (!version) notFound();

  const { businessNoun } = resolveSegmentVocab(clinicRow?.segment ?? "dental");
  const bookingNoun = clinicRow?.bookingNoun ?? resolveSegmentVocab(clinicRow?.segment ?? "dental").bookingNoun;

  return (
    <PlaybookEditorClient
      id={version.id}
      name={version.name}
      greetingMessage={clinicRow?.greetingMessage ?? ""}
      businessNoun={businessNoun}
      bookingNoun={bookingNoun}
      libraryAssets={libraryAssets.map((a) => ({ id: a.id, title: a.title, type: a.type }))}
      initialData={{
        specialty: version.specialty ?? "",
        toneOfVoice: version.toneOfVoice,
        receptionistName: version.receptionistName,
        differentials: version.differentials.length > 0 ? version.differentials : [""],
        commercialPolicy: version.commercialPolicy ?? "",
        objections: version.objections.length > 0 ? version.objections : [],
        notes: version.notes ?? "",
        mediaAssetIds: version.mediaAssetIds ?? [],
      }}
    />
  );
}
