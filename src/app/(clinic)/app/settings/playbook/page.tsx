export const dynamic = "force-dynamic";

import { db } from "@/infrastructure/db/client";
import { clinics, playbookVersions } from "@/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import { IASettingsClient } from "./ia-settings-client";
import type { MenuItem } from "@/domain/entities/clinic";

async function getData() {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const [clinic, versions] = await Promise.all([
    db
      .select({
        name: clinics.name,
        autoReplyEnabled: clinics.autoReplyEnabled,
        takeoverTtlHours: clinics.takeoverTtlHours,
        postAppointmentBufferMinutes: clinics.postAppointmentBufferMinutes,
        businessHours: clinics.businessHours,
        greetingMessage: clinics.greetingMessage,
        menuItems: clinics.menuItems,
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
  ]);
  return { clinic, versions };
}

export default async function PlaybookPage() {
  const { clinic, versions } = await getData();

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
      }}
      versions={versions.map((v) => ({
        id: v.id,
        name: v.name,
        status: v.status as "active" | "draft" | "historical",
        updatedAt: v.updatedAt,
      }))}
    />
  );
}
