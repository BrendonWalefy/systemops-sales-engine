import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { eq, and, count } from "drizzle-orm";
import { SidebarNav } from "@/components/sidebar-nav";
import { PushNotificationSetup } from "@/components/push-notification-setup";
import { RealtimeEventsProvider } from "@/components/realtime-events-provider";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { db } from "@/infrastructure/db/client";
import { clinicMembers, conversations } from "@/infrastructure/db/schema";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";

export default async function ClinicLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;

  let avatarUrl: string | null = null;
  let inboxBadge = 0;

  if (session?.email) {
    try {
      const clinicId = await requireSessionClinicId();
      const [memberResult, badgeResult] = await Promise.all([
        db
          .select({ avatarUrl: clinicMembers.avatarUrl })
          .from(clinicMembers)
          .where(and(eq(clinicMembers.email, session.email), eq(clinicMembers.clinicId, clinicId)))
          .limit(1),
        db
          .select({ count: count() })
          .from(conversations)
          .where(and(eq(conversations.clinicId, clinicId), eq(conversations.needsAttention, true))),
      ]);
      avatarUrl = memberResult[0]?.avatarUrl ?? null;
      inboxBadge = badgeResult[0]?.count ?? 0;
    } catch {
      // fallback silencioso
    }
  }

  return (
    <RealtimeEventsProvider>
      <div className="clinic-layout">
        <SidebarNav email={session?.email} avatarUrl={avatarUrl} inboxBadge={inboxBadge} isOwner={session?.role === "owner"} />
        <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
        <PushNotificationSetup />
      </div>
    </RealtimeEventsProvider>
  );
}
