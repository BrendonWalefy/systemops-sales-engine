import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics } from "@/infrastructure/db/schema";
import { e2eGuard, E2E_CLINIC_ID } from "../../_guard";

const SETTINGS_COLUMNS = {
  greetingMessage: clinics.greetingMessage,
  menuItems: clinics.menuItems,
  businessHours: clinics.businessHours,
  takeoverTtlHours: clinics.takeoverTtlHours,
  postAppointmentBufferMinutes: clinics.postAppointmentBufferMinutes,
} as const;

// GET /api/e2e/clinic/settings
export async function GET(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: "E2E_CLINIC_ID not configured" }, { status: 500 });
  }

  const clinic = await db
    .select(SETTINGS_COLUMNS)
    .from(clinics)
    .where(eq(clinics.id, E2E_CLINIC_ID))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!clinic) {
    return NextResponse.json({ error: "clinic not found" }, { status: 404 });
  }

  return NextResponse.json(clinic);
}

// PATCH /api/e2e/clinic/settings
// Body: Partial<{ greetingMessage, menuItems, businessHours, takeoverTtlHours, postAppointmentBufferMinutes, staleConversationHours, slotLookaheadDays, mediaTakeoverTtlHours }>
export async function PATCH(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  if (!E2E_CLINIC_ID) {
    return NextResponse.json({ error: "E2E_CLINIC_ID not configured" }, { status: 500 });
  }

  const body = await req.json();
  const allowed = [
    "greetingMessage",
    "menuItems",
    "businessHours",
    "takeoverTtlHours",
    "postAppointmentBufferMinutes",
    "staleConversationHours",
    "slotLookaheadDays",
    "mediaTakeoverTtlHours",
  ];
  const patch = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k)),
  );

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  await db.update(clinics).set(patch).where(eq(clinics.id, E2E_CLINIC_ID));

  return NextResponse.json({ ok: true });
}
