export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { organizations, playbookVersions } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PlaybookEditorClient } from "./editor-client";

export default async function PlaybookEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const clinicId = await requireSessionClinicId();

  const [[version], clinicRow] = await Promise.all([
    db
      .select()
      .from(playbookVersions)
      .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, clinicId)))
      .limit(1),
    db
      .select({ greetingMessage: organizations.greetingMessage })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  if (!version) notFound();

  return (
    <PlaybookEditorClient
      id={version.id}
      name={version.name}
      greetingMessage={clinicRow?.greetingMessage ?? ""}
      initialData={{
        specialty: version.specialty ?? "",
        procedureDescription: version.procedureDescription ?? "",
        toneOfVoice: version.toneOfVoice,
        receptionistName: version.receptionistName,
        differentials: version.differentials.length > 0 ? version.differentials : [""],
        commercialPolicy: version.commercialPolicy ?? "",
        objections: version.objections.length > 0 ? version.objections : [],
        notes: version.notes ?? "",
        mediaLibrary: (version.mediaLibrary as { id: string; title: string; url: string; type: "video" | "image" }[] | null) ?? [],
      }}
    />
  );
}
