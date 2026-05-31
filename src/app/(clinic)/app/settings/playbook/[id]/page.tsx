export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { playbookVersions } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PlaybookEditorClient } from "./editor-client";

export default async function PlaybookEditorPage({ params }: { params: { id: string } }) {
  const clinicId = process.env.PILOT_CLINIC_ID!;

  const [version] = await db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.id, params.id), eq(playbookVersions.clinicId, clinicId)))
    .limit(1);

  if (!version) notFound();

  return (
    <PlaybookEditorClient
      id={version.id}
      name={version.name}
      initialData={{
        specialty: version.specialty ?? "",
        procedureDescription: version.procedureDescription ?? "",
        toneOfVoice: version.toneOfVoice,
        differentials: version.differentials.length > 0 ? version.differentials : [""],
        commercialPolicy: version.commercialPolicy ?? "",
        objections:
          version.objections.length > 0 ? version.objections : [],
      }}
    />
  );
}
