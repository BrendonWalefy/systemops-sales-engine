"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { createLogger } from "@/infrastructure/logging/logger";

async function requireOwner(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner";
}

/**
 * Server action: atualiza controles do Channel Safety Engine para uma clínica.
 *
 * - `outboundHourlyCap` e `outboundDailyCap`: tetos de cadência de saída
 *   (defaults conservadores 40/200 — Safety Gate usa esses valores no envio).
 * - `automatedReengagementPaused`: pausa follow-up e recovery sem desligar replies.
 *   appointment-reminder NUNCA é afetado por este toggle.
 *
 * Tenant resolvido pelo `clinicId` da rota — nunca por env.
 * Segurança: somente role="owner" pode alterar.
 */
export async function updateChannelSafetySettings(
  clinicId: string,
  formData: FormData,
): Promise<void> {
  if (!(await requireOwner())) {
    redirect(`/owner/clinics/${clinicId}?channelSafetyError=unauthorized`);
  }

  const rawHourly = Number(formData.get("outbound_hourly_cap"));
  const rawDaily = Number(formData.get("outbound_daily_cap"));
  const pauseReengagement = formData.get("automated_reengagement_paused") === "on";
  const safetyMode = formData.get("channel_safety_mode") as string;

  const validModes = ["normal", "atencao", "cooling", "frozen"];
  if (!validModes.includes(safetyMode)) {
    redirect(`/owner/clinics/${clinicId}?channelSafetyError=invalid_safety_mode`);
  }

  if (!Number.isInteger(rawHourly) || rawHourly < 1) {
    redirect(`/owner/clinics/${clinicId}?channelSafetyError=invalid_hourly_cap`);
  }
  if (!Number.isInteger(rawDaily) || rawDaily < 1) {
    redirect(`/owner/clinics/${clinicId}?channelSafetyError=invalid_daily_cap`);
  }

  await db
    .update(organizations)
    .set({
      outboundHourlyCap: rawHourly,
      outboundDailyCap: rawDaily,
      automatedReengagementPaused: pauseReengagement,
      channelSafetyMode: safetyMode,
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, clinicId));

  createLogger({ scope: "OwnerPanel", clinicId }).info("clinic.channel_safety_updated", {
    outboundHourlyCap: rawHourly,
    outboundDailyCap: rawDaily,
    automatedReengagementPaused: pauseReengagement,
    channelSafetyMode: safetyMode,
  });

  redirect(`/owner/clinics/${clinicId}?channelSafetyOk=1`);
}
