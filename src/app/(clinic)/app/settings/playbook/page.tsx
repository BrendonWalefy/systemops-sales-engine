export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { clinics, playbookVersions } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import { IASettingsClient } from "./ia-settings-client";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import type { ConversationExperience, MenuItem } from "@/domain/entities/clinic";
import { DEFAULT_CONVERSATION_EXPERIENCE } from "@/domain/entities/clinic";

async function getData() {
  const clinicId = await requireSessionClinicId();
  const [clinic, versions, treatments] = await Promise.all([
    db
      .select({
        name: clinics.name,
        autoReplyEnabled: clinics.autoReplyEnabled,
        takeoverTtlHours: clinics.takeoverTtlHours,
        postAppointmentBufferMinutes: clinics.postAppointmentBufferMinutes,
        conversationExperience: clinics.conversationExperience,
        businessHours: clinics.businessHours,
        greetingMessage: clinics.greetingMessage,
        menuItems: clinics.menuItems,
        receptionistPhone: clinics.receptionistPhone,
        installmentRates: clinics.installmentRates,
        voiceResponseEnabled: clinics.voiceResponseEnabled,
        ttsVoice: clinics.ttsVoice,
      })
      .from(clinics)
      .where(eq(clinics.id, clinicId))
      .limit(1)
      .then((r) => r[0] ?? null),
    db
      .select({
        id: playbookVersions.id,
        name: playbookVersions.name,
        status: playbookVersions.status,
        updatedAt: playbookVersions.updatedAt,
      })
      .from(playbookVersions)
      .where(eq(playbookVersions.clinicId, clinicId))
      .orderBy(desc(playbookVersions.updatedAt)),
    new DrizzleTreatmentRepository().listByClinic(clinicId),
  ]);
  return { clinic, versions, treatments };
}

export default async function PlaybookPage() {
  const { clinic, versions, treatments } = await getData();

  return (
    <IASettingsClient
      clinic={{
        name: clinic?.name ?? null,
        autoReplyEnabled: clinic?.autoReplyEnabled ?? false,
        takeoverTtlHours: clinic?.takeoverTtlHours ?? 4,
        postAppointmentBufferMinutes: clinic?.postAppointmentBufferMinutes ?? 60,
        conversationExperience: (clinic?.conversationExperience as ConversationExperience | null) ?? DEFAULT_CONVERSATION_EXPERIENCE,
        businessHours: clinic?.businessHours ?? null,
        greetingMessage: clinic?.greetingMessage ?? null,
        menuItems: (clinic?.menuItems as MenuItem[] | null) ?? null,
        receptionistPhone: clinic?.receptionistPhone ?? null,
        installmentRates: (clinic?.installmentRates as { n: number; rate: number; active: boolean }[] | null) ?? null,
        voiceResponseEnabled: clinic?.voiceResponseEnabled ?? false,
        ttsVoice: clinic?.ttsVoice ?? "nova",
      }}
      versions={versions.map((v) => ({
        id: v.id,
        name: v.name,
        status: v.status as "active" | "draft" | "historical",
        updatedAt: v.updatedAt,
      }))}
      treatments={treatments}
    />
  );
}
