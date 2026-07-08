export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  playbookVersions,
  treatments,
} from "@/infrastructure/db/schema";
import { OnboardingWizardClient } from "./onboarding-wizard-client";
import type { PipelineStep } from "@/domain/entities/treatment";
import { decryptCredentialNullable } from "@/infrastructure/crypto/credential-vault";
import { DrizzleMediaAssetRepository } from "@/infrastructure/repositories/drizzle-media-asset-repository";

const mediaAssetRepo = new DrizzleMediaAssetRepository();

export default async function OnboardingWizardPage({
  params,
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;

  const [clinic, activePlaybook, existingTreatments, mediaAssets] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, clinicId),
      columns: {
        id: true,
        name: true,
        specialty: true,
        city: true,
        address: true,
        greetingMessage: true,
        businessHours: true,
        calendarMode: true,
        googleCalendarId: true,
        receptionistPhone: true,
        plan: true,
        monthlyRevenueBrl: true,
        billingStartedAt: true,
        isTest: true,
        autoReplyEnabled: true,
        channelProvider: true,
        zapiInstanceId: true,
        zapiToken: true,
        zapiClientToken: true,
        metaPhoneNumberId: true,
        metaAccessToken: true,
        defaultAppointmentDurationMinutes: true,
        postAppointmentBufferMinutes: true,
        takeoverTtlHours: true,
      },
    }),
    db.query.playbookVersions.findFirst({
      where: and(
        eq(playbookVersions.clinicId, clinicId),
        eq(playbookVersions.status, "active"),
      ),
      columns: {
        toneOfVoice: true,
        differentials: true,
        commercialPolicy: true,
        notes: true,
      },
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
    mediaAssetRepo.listByClinic(clinicId),
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
          differentials:
            (activePlaybook?.differentials as string[] | null) ?? [],
        },
        schedule: {
          businessHours: clinic.businessHours ?? "Seg-Sex 8h-18h",
          calendarMode: clinic.calendarMode ?? "internal",
          googleCalendarId: clinic.googleCalendarId ?? "",
          receptionistPhone: clinic.receptionistPhone ?? "",
          defaultDurationMinutes:
            clinic.defaultAppointmentDurationMinutes ?? 60,
          bufferMinutes: clinic.postAppointmentBufferMinutes ?? 30,
          takeoverTtlHours: clinic.takeoverTtlHours ?? 4,
        },
        channel: {
          provider: clinic.channelProvider ?? "z_api",
          zapiInstanceId: clinic.zapiInstanceId ?? "",
          zapiToken: decryptCredentialNullable(clinic.zapiToken) ?? "",
          zapiClientToken: decryptCredentialNullable(clinic.zapiClientToken) ?? "",
          metaPhoneNumberId: clinic.metaPhoneNumberId ?? "",
          metaAccessToken: decryptCredentialNullable(clinic.metaAccessToken) ?? "",
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
          plan: clinic.plan ?? "enterprise",
          billingActive:
            !clinic.isTest &&
            ((clinic.monthlyRevenueBrl ?? 0) > 0 ||
              clinic.billingStartedAt !== null),
          monthlyRevenueBrl:
            clinic.monthlyRevenueBrl && clinic.monthlyRevenueBrl > 0
              ? String(Math.round(clinic.monthlyRevenueBrl / 100))
              : "",
          billingStartedAt: clinic.billingStartedAt
            ? clinic.billingStartedAt.toISOString().slice(0, 10)
            : "",
          isTest: clinic.isTest,
        },
        mediaLibrary: mediaAssets
          .filter((a) => a.type === "video" || a.type === "image")
          .map((a) => ({ id: a.id, title: a.title, url: a.url, type: a.type as "video" | "image" })),
        autoReplyEnabled: clinic.autoReplyEnabled,
      }}
    />
  );
}
