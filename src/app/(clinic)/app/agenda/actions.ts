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

function isAllDay(formData: FormData): boolean {
  return formData.get("allDay") === "true";
}

function parseDateParts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error("Data inválida");
  }

  return [year, month, day];
}

function parseTimeParts(time: string): [number, number] {
  const [hour, minute] = time.split(":").map(Number);

  if (isNaN(hour) || isNaN(minute)) {
    throw new Error("Horário inválido");
  }

  return [hour, minute];
}

function nextDateParts(year: number, month: number, day: number): [number, number, number] {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()];
}

function getFullDayWindow(tz: ClinicTimezone, year: number, month: number, day: number) {
  const [nextYear, nextMonth, nextDay] = nextDateParts(year, month, day);

  return {
    startsAt: tz.fromLocalParts(year, month - 1, day, 0, 0),
    endsAt: tz.fromLocalParts(nextYear, nextMonth - 1, nextDay, 0, 0),
  };
}

export async function createBlock(formData: FormData) {
  const session = await requireAuth();
  if (!session) throw new Error("Unauthorized");

  const date = formData.get("date") as string;
  const startTime = formData.get("startTime") as string;
  const endTime = formData.get("endTime") as string;
  const reason = (formData.get("reason") as string | null)?.trim() ?? "";
  const allDay = isAllDay(formData);

  if (!date || (!allDay && (!startTime || !endTime))) throw new Error("Campos obrigatórios ausentes");

  const [year, month, day] = parseDateParts(date);

  const { clinicId, tz, gateway } = await getGateway();
  const { startsAt, endsAt } = allDay
    ? getFullDayWindow(tz, year, month, day)
    : {
      startsAt: tz.fromLocalParts(year, month - 1, day, ...parseTimeParts(startTime)),
      endsAt: tz.fromLocalParts(year, month - 1, day, ...parseTimeParts(endTime)),
    };

  if (endsAt <= startsAt) return { error: "Horário de fim deve ser após o início" };
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
  const allDay = isAllDay(formData);

  if (!dateFrom || !dateTo || (!allDay && (!startTime || !endTime))) {
    throw new Error("Campos obrigatórios ausentes");
  }

  const [fy, fm, fd] = parseDateParts(dateFrom);
  const [ty, tm, td] = parseDateParts(dateTo);
  const [startH, startM] = allDay ? [0, 0] : parseTimeParts(startTime);
  const [endH, endM] = allDay ? [0, 0] : parseTimeParts(endTime);

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

    const { startsAt, endsAt } = allDay
      ? getFullDayWindow(tz, year, month, day)
      : {
        startsAt: tz.fromLocalParts(year, month - 1, day, startH, startM),
        endsAt: tz.fromLocalParts(year, month - 1, day, endH, endM),
      };

    if (endsAt <= startsAt) throw new Error("Horário de fim deve ser após o início");
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
