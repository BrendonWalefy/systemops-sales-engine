"use server";

import { db } from "@/infrastructure/db/client";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { clinics, playbookVersions } from "@/infrastructure/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function savePlaybook(formData: FormData) {
  const clinicId = await requireSessionClinicId();
  const toneOfVoice = (formData.get("toneOfVoice") as string) || null;
  const commercialPolicy = (formData.get("commercialPolicy") as string) || null;
  const notes = (formData.get("playbook") as string) || null;

  // Gate: não deixa salvar política comercial vazia (a IA inventaria).
  if (!commercialPolicy || !commercialPolicy.trim()) {
    throw new Error("Política comercial não pode ser vazia.");
  }
  const businessHours = (formData.get("businessHours") as string) || null;

  // businessHours é OPERACIONAL (usado pelo agendador) — continua em clinics.
  await db
    .update(clinics)
    .set({ businessHours, updatedAt: new Date() })
    .where(eq(clinics.id, clinicId));

  // Campos EDITORIAIS vão para a versão ATIVA do playbook (fonte única).
  const active = await db
    .select({ id: playbookVersions.id })
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, clinicId), eq(playbookVersions.status, "active")))
    .orderBy(desc(playbookVersions.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (active) {
    await db
      .update(playbookVersions)
      .set({ toneOfVoice: toneOfVoice ?? "acolhedor", commercialPolicy, notes, updatedAt: new Date() })
      .where(eq(playbookVersions.id, active.id));
  } else {
    await db.insert(playbookVersions).values({
      clinicId,
      name: "Editado em settings",
      status: "active",
      toneOfVoice: toneOfVoice ?? "acolhedor",
      commercialPolicy,
      notes,
      procedureDescription: "",
      differentials: [],
      objections: [],
    });
  }

  revalidatePath("/app/settings/playbook");
}

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
  const raw = parseInt(formData.get("postAppointmentBufferMinutes") as string, 10);
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
  await db
    .update(clinics)
    .set({
      autoReplyEnabled: !currentValue,
      updatedAt: new Date(),
    })
    .where(eq(clinics.id, clinicId));
  revalidatePath("/app/settings/playbook");
}
