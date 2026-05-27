"use server";

export const maxDuration = 30;

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

  const tz = new ClinicTimezone(clinic.timezone);
  return {
    clinicId,
    tz,
    gateway: new GoogleCalendarGateway(
      clinic.googleCalendarId,
      tz,
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

  const [year, month, day] = date.split("-").map(Number);
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);

  if (!year || !month || !day || isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) {
    throw new Error("Data ou horário inválido");
  }

  const { clinicId, tz, gateway } = await getGateway();

  const startsAt = tz.fromLocalParts(year, month - 1, day, startH, startM);
  const endsAt = tz.fromLocalParts(year, month - 1, day, endH, endM);

  if (endsAt <= startsAt) throw new Error("Horário de fim deve ser após o início");
  await gateway.createBlockEvent({ clinicId, startsAt, endsAt, reason });

  revalidatePath("/app/agenda");
}

export async function createBlockRange(formData: FormData) {
  const session = await requireAuth();
  if (!session) throw new Error("Unauthorized");

  const dateFrom = formData.get("dateFrom") as string;
  const dateTo = formData.get("dateTo") as string;
  const startTime = formData.get("startTime") as string;
  const endTime = formData.get("endTime") as string;
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";

  if (!dateFrom || !dateTo || !startTime || !endTime) throw new Error("Campos obrigatórios ausentes");

  const [fy, fm, fd] = dateFrom.split("-").map(Number);
  const [ty, tm, td] = dateTo.split("-").map(Number);
  const [startH, startM] = startTime.split(":").map(Number);
  const [endH, endM] = endTime.split(":").map(Number);

  if ([fy, fm, fd, ty, tm, td, startH, startM, endH, endM].some(isNaN)) {
    throw new Error("Data ou horário inválido");
  }

  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);

  if (toMs < fromMs) throw new Error("Data de fim deve ser após a data de início");

  const diffDays = Math.round((toMs - fromMs) / 86_400_000) + 1;
  if (diffDays > 90) throw new Error("Período máximo de 90 dias");

  const { clinicId, tz, gateway } = await getGateway();

  for (let i = 0; i < diffDays; i++) {
    const d = new Date(fromMs + i * 86_400_000);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();

    const startsAt = tz.fromLocalParts(year, month - 1, day, startH, startM);
    const endsAt = tz.fromLocalParts(year, month - 1, day, endH, endM);

    if (endsAt <= startsAt) continue;
    await gateway.createBlockEvent({ clinicId, startsAt, endsAt, reason });
  }

  revalidatePath("/app/agenda");
}

export async function deleteBlock(calendarEventId: string) {
  const session = await requireAuth();
  if (!session) throw new Error("Unauthorized");

  const { gateway } = await getGateway();
  await gateway.deleteBlockEvent({ calendarEventId });

  revalidatePath("/app/agenda");
}
