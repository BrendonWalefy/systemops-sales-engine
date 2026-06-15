"use server";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resolveOperationalStatusFromAutomationState } from "@/application/clinics/clinic-operational-status";

export async function saveTakeoverTtl(formData: FormData) {
  const clinicId = await requireSessionClinicId();
  const raw = parseInt(formData.get("takeoverTtlHours") as string, 10);
  const ttlHours = isNaN(raw) || raw < 0 ? 4 : Math.min(raw, 72);
  await db
    .update(clinics)
    .set({ takeoverTtlHours: ttlHours, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}

export async function saveSchedulingPolicy(formData: FormData) {
  const clinicId = await requireSessionClinicId();
  const raw = parseInt(
    formData.get("postAppointmentBufferMinutes") as string,
    10,
  );
  const bufferMinutes = isNaN(raw) || raw < 0 ? 60 : Math.min(raw, 240);
  await db
    .update(clinics)
    .set({ postAppointmentBufferMinutes: bufferMinutes, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}

export async function saveBusinessHours(formData: FormData) {
  const clinicId = await requireSessionClinicId();
  await db
    .update(clinics)
    .set({
      businessHours: (formData.get("businessHours") as string) || null,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}

export async function toggleAutoReply(currentValue: boolean) {
  const clinicId = await requireSessionClinicId();
  const clinic = await db.query.clinics.findFirst({
    where: eq(clinics.id, clinicId),
    columns: {
      isTest: true,
      operationalStatus: true,
    },
  });
  if (!clinic) return;

  await db
    .update(clinics)
    .set({
      autoReplyEnabled: !currentValue,
      operationalStatus: resolveOperationalStatusFromAutomationState({
        currentStatus: clinic.operationalStatus,
        isTest: clinic.isTest,
        autoReplyEnabled: !currentValue,
      }),
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}
