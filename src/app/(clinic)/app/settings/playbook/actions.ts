"use server";

import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function savePlaybook(formData: FormData) {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  await db
    .update(clinics)
    .set({
      toneOfVoice: (formData.get("toneOfVoice") as string) || null,
      businessHours: (formData.get("businessHours") as string) || null,
      commercialPolicy: (formData.get("commercialPolicy") as string) || null,
      playbook: (formData.get("playbook") as string) || null,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}

export async function saveTakeoverTtl(formData: FormData) {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const raw = parseInt(formData.get("takeoverTtlHours") as string, 10);
  const ttlHours = isNaN(raw) || raw < 0 ? 4 : Math.min(raw, 72);
  await db
    .update(clinics)
    .set({ takeoverTtlHours: ttlHours, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}

export async function saveSchedulingPolicy(formData: FormData) {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  const raw = parseInt(formData.get("postAppointmentBufferMinutes") as string, 10);
  const bufferMinutes = isNaN(raw) || raw < 0 ? 60 : Math.min(raw, 240);
  await db
    .update(clinics)
    .set({ postAppointmentBufferMinutes: bufferMinutes, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}

export async function toggleAutoReply(currentValue: boolean) {
  const clinicId = process.env.PILOT_CLINIC_ID!;
  await db
    .update(clinics)
    .set({
      autoReplyEnabled: !currentValue,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}
