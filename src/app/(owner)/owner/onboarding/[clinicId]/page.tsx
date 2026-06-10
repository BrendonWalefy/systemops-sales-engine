export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics, playbookVersions, treatments } from "@/infrastructure/db/schema";
import { OnboardingWizardClient } from "./onboarding-wizard-client";
import type { PipelineStep } from "@/domain/entities/treatment";

type MediaItem = { id: string; title: string; url: string; type: "video" | "image" };

export default async function OnboardingWizardPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;

  const [clinic, activePlaybook, existingTreatments] = await Promise.all([
    db.query.clinics.findFirst({
      where: eq(clinics.id, clinicId),
      columns: {
        id: true,
        name: true,
        specialty: true,
        city: true,
        address: true,
        greetingMessage: true,
        businessHours: true,
        defaultAppointmentDurationMinutes: true,
        postAppointmentBufferMinutes: true,
        takeoverTtlHours: true,
      },
    }),
    db.query.playbookVersions.findFirst({
      where: and(eq(playbookVersions.clinicId, clinicId), eq(playbookVersions.status, "active")),
      columns: { toneOfVoice: true, differentials: true, commercialPolicy: true, notes: true, mediaLibrary: true },
    }),
    db.query.treatments.findMany({
      where: eq(treatments.clinicId, clinicId),
      orderBy: treatments.name,
      columns: {
        id: true,
        name: true,
        durationMinutes: true,
        requiresEvaluationFirst: true,
        isAesthetic: true,
        aliases: true,
        pipelineSteps: true,
      },
    }),
  ]);

  if (!clinic) notFound();

  return (
    <OnboardingWizardClient
      clinicId={clinicId}
      clinicName={clinic.name}
      initial={{
        identity: {
          specialty: clinic.specialty ?? "",
          city: clinic.city ?? "",
          address: clinic.address ?? "",
          greetingMessage: clinic.greetingMessage ?? "",
        },
        receptionist: {
          toneOfVoice: activePlaybook?.toneOfVoice ?? "acolhedor",
          differentials: (activePlaybook?.differentials as string[] | null) ?? [],
        },
        schedule: {
          businessHours: clinic.businessHours ?? "Seg-Sex 8h-18h",
          defaultDurationMinutes: clinic.defaultAppointmentDurationMinutes ?? 60,
          bufferMinutes: clinic.postAppointmentBufferMinutes ?? 30,
          takeoverTtlHours: clinic.takeoverTtlHours ?? 4,
        },
        treatments: existingTreatments.map((t) => ({
          id: t.id,
          name: t.name,
          durationMinutes: t.durationMinutes,
          requiresEvaluationFirst: t.requiresEvaluationFirst,
          isAesthetic: t.isAesthetic,
          aliases: (t.aliases as string[]).join(", "),
          pipelineSteps: (t.pipelineSteps as PipelineStep[] | null) ?? null,
        })),
        policy: {
          commercialPolicy: activePlaybook?.commercialPolicy ?? "",
          notes: activePlaybook?.notes ?? "",
        },
        mediaLibrary: (activePlaybook?.mediaLibrary as MediaItem[] | null) ?? [],
      }}
    />
  );
}
