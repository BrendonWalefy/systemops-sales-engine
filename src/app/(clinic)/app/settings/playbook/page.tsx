export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { getSessionMemberProfile, canEditPrices } from "@/application/tenancy/member-role";
import { organizations, playbookVersions } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import { IASettingsClient } from "./ia-settings-client";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import type { MenuItem } from "@/domain/entities/clinic";
import { getClinicModules } from "@/application/modules/module-gate";

async function getData() {
  const clinicId = await requireSessionClinicId();
  const [clinic, versions, treatments, activeModules, memberProfile] = await Promise.all([
    db
      .select({
        name: organizations.name,
        autoReplyEnabled: organizations.autoReplyEnabled,
        takeoverTtlHours: organizations.takeoverTtlHours,
        postAppointmentBufferMinutes: organizations.postAppointmentBufferMinutes,
        businessHours: organizations.businessHours,
        greetingMessage: organizations.greetingMessage,
        menuItems: organizations.menuItems,
        receptionistPhone: organizations.receptionistPhone,
        staleConversationHours: organizations.staleConversationHours,
        slotLookaheadDays: organizations.slotLookaheadDays,
        mediaTakeoverTtlHours: organizations.mediaTakeoverTtlHours,
        installmentRates: organizations.installmentRates,
        serviceNoun: organizations.serviceNoun,
      })
      .from(organizations)
      .where(eq(organizations.id, clinicId))
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
    getClinicModules(clinicId),
    getSessionMemberProfile(clinicId),
  ]);
  return { clinic, versions, treatments, activeModules, memberProfile };
}

export default async function PlaybookPage() {
  const { clinic, versions, treatments, activeModules, memberProfile } = await getData();
  const pricesEditable = memberProfile ? canEditPrices(memberProfile) : true;
  const serviceNoun = clinic?.serviceNoun ?? "tratamento";

  return (
    <IASettingsClient
      clinic={{
        name: clinic?.name ?? null,
        autoReplyEnabled: clinic?.autoReplyEnabled ?? false,
        takeoverTtlHours: clinic?.takeoverTtlHours ?? 4,
        postAppointmentBufferMinutes: clinic?.postAppointmentBufferMinutes ?? 60,
        businessHours: clinic?.businessHours ?? null,
        greetingMessage: clinic?.greetingMessage ?? null,
        menuItems: (clinic?.menuItems as MenuItem[] | null) ?? null,
        receptionistPhone: clinic?.receptionistPhone ?? null,
        staleConversationHours: clinic?.staleConversationHours ?? 4,
        slotLookaheadDays: clinic?.slotLookaheadDays ?? 14,
        mediaTakeoverTtlHours: clinic?.mediaTakeoverTtlHours ?? null,
        installmentRates: (clinic?.installmentRates as { n: number; rate: number; active: boolean }[] | null) ?? null,
        activeModules,
      }}
      versions={versions.map((v) => ({
        id: v.id,
        name: v.name,
        status: v.status as "active" | "draft" | "historical",
        updatedAt: v.updatedAt,
      }))}
      treatments={treatments}
      canEditPrices={pricesEditable}
      serviceNoun={serviceNoun}
    />
  );
}
