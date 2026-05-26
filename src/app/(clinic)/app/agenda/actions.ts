"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { GoogleCalendarGateway } from "@/infrastructure/adapters/calendar/google/google-calendar-gateway";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

async function getGateway() {
  const clinicId = process.env.PILOT_CLINIC_ID;
  if (!clinicId) throw new Error("PILOT_CLINIC_ID not set");

  const [clinic] = await db
    .select({ googleCalendarId: clinics.googleCalendarId, timezone: clinics.timezone, businessHours: clinics.businessHours })
    .from(clinics)
    .where(eq(clinics.id, clinicId))
    .limit(1);

  if (!clinic) throw new Error("Clinic not found");

  return {
    clinicId,
    gateway: new GoogleCalendarGateway(
      clinic.googleCalendarId,
      new ClinicTimezone(clinic.timezone),
      clinic.businessHours,
    ),
  };
}

async function requireAuth() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? verifyToken(token) : null;
}

export async function createBlock(formData: FormData) {
  const session = await requireAuth();
  if (!session) throw new Error("Unauthorized");

  const date = formData.get("date") as string;
  const startTime = formData.get("startTime") as string;
  const endTime = formData.get("endTime") as string;
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";

  if (!date || !startTime || !endTime) throw new Error("Campos obrigatórios ausentes");

  const startsAt = new Date(`${date}T${startTime}:00`);
  const endsAt = new Date(`${date}T${endTime}:00`);

  if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) throw new Error("Data ou horário inválido");
  if (endsAt <= startsAt) throw new Error("Horário de fim deve ser após o início");

  const { clinicId, gateway } = await getGateway();
  await gateway.createBlockEvent({ clinicId, startsAt, endsAt, reason });

  revalidatePath("/app/agenda");
}

export async function deleteBlock(calendarEventId: string) {
  const session = await requireAuth();
  if (!session) throw new Error("Unauthorized");

  const { gateway } = await getGateway();
  await gateway.deleteBlockEvent({ calendarEventId });

  revalidatePath("/app/agenda");
}
