"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runOperationalRecheck } from "@/application/health/run-operational-recheck";
import { COOKIE_NAME, verifyToken } from "@/lib/session";

async function requireOwner(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner";
}

export async function recheckOperationalHealth(formData: FormData) {
  if (!(await requireOwner())) {
    redirect("/login");
  }

  const clinicIdRaw = formData.get("clinicId");
  const clinicId =
    typeof clinicIdRaw === "string" && clinicIdRaw.trim().length > 0
      ? clinicIdRaw.trim()
      : undefined;

  try {
    const result = await runOperationalRecheck({ clinicId });

    revalidatePath("/owner");
    revalidatePath("/owner/qualidade");

    const params = new URLSearchParams({
      recheck:
        result.failedCount === 0
          ? "ok"
          : result.processedCount > 0
            ? "partial"
            : "error",
      scope: clinicId ? "clinic" : "all",
      processed: String(result.processedCount),
      failed: String(result.failedCount),
      channelDegraded: String(result.channelDegradedCount),
      snapshotAlerts: String(result.snapshotAlertCount),
    });

    redirect(`/owner/qualidade?${params.toString()}`);
  } catch (error) {
    const params = new URLSearchParams({
      recheck: "error",
      scope: clinicId ? "clinic" : "all",
      processed: "0",
      failed: "1",
      message: error instanceof Error ? error.message : "Falha no recheck",
    });

    redirect(`/owner/qualidade?${params.toString()}`);
  }
}
