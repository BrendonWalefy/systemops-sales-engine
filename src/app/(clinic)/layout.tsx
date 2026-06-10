import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import { SidebarNav } from "@/components/sidebar-nav";
import { PushNotificationSetup } from "@/components/push-notification-setup";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { db } from "@/infrastructure/db/client";
import { clinicMembers } from "@/infrastructure/db/schema";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";

export default async function ClinicLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;

  let avatarUrl: string | null = null;
  if (session?.email) {
    try {
      const clinicId = await requireSessionClinicId();
      const [member] = await db
        .select({ avatarUrl: clinicMembers.avatarUrl })
        .from(clinicMembers)
        .where(and(eq(clinicMembers.email, session.email), eq(clinicMembers.clinicId, clinicId)))
        .limit(1);
      avatarUrl = member?.avatarUrl ?? null;
    } catch {
      // fallback: sem avatar
    }
  }

  return (
    <div className="clinic-layout">
      <SidebarNav email={session?.email} avatarUrl={avatarUrl} />
      <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
      <PushNotificationSetup />
    </div>
  );
}
