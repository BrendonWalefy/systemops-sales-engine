export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { clinics, playbookVersions } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PlaybookEditorClient } from "./editor-client";

export default async function PlaybookEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const clinicId = process.env.PILOT_CLINIC_ID!;

  const [[version], clinicRow] = await Promise.all([
    db
      .select()
      .from(playbookVersions)
      .where(and(eq(playbookVersions.id, id), eq(playbookVersions.clinicId, clinicId)))
      .limit(1),
    db
      .select({
        businessHours: clinics.businessHours,
        takeoverTtlHours: clinics.takeoverTtlHours,
        postAppointmentBufferMinutes: clinics.postAppointmentBufferMinutes,
        greetingMessage: clinics.greetingMessage,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

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
        objections: version.objections.length > 0 ? version.objections : [],
        businessHours: clinicRow?.businessHours ?? "",
        takeoverTtlHours: clinicRow?.takeoverTtlHours ?? 4,
        postAppointmentBufferMinutes: clinicRow?.postAppointmentBufferMinutes ?? 60,
        greetingMessage: clinicRow?.greetingMessage ?? "",
      }}
    />
  );
}
