import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { eq, and, count } from "drizzle-orm";
import { SidebarNav } from "@/components/sidebar-nav";
import { PushNotificationSetup } from "@/components/push-notification-setup";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { db } from "@/infrastructure/db/client";
import { clinicMembers, conversations, organizations } from "@/infrastructure/db/schema";
import { requireSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { setSentryClinic } from "@/infrastructure/logging/sentry";
import { measureServerOperation } from "@/infrastructure/observability/performance-logger";
import { NavigationPerformanceReporter } from "@/components/performance/navigation-performance-reporter";

export default async function ClinicLayout({ children }: { children: ReactNode }) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;

  let avatarUrl: string | null = null;
  let inboxBadge = 0;
  let clinicName = "SystemOps";

  if (session?.email) {
    try {
      const clinicId = await requireSessionClinicId();
      setSentryClinic(clinicId);
      const [memberResult, badgeResult, clinicResult] = await measureServerOperation(
        {
          clinicId,
          surface: "clinic_shell",
          operation: "shell_context",
        },
        () => Promise.all([
          db
            .select({ avatarUrl: clinicMembers.avatarUrl })
            .from(clinicMembers)
            .where(and(eq(clinicMembers.email, session.email), eq(clinicMembers.clinicId, clinicId)))
            .limit(1),
          db
            .select({ count: count() })
            .from(conversations)
            .where(and(eq(conversations.clinicId, clinicId), eq(conversations.needsAttention, true))),
          db
            .select({ name: organizations.name })
            .from(organizations)
            .where(eq(organizations.id, clinicId))
            .limit(1),
        ]),
      );
      avatarUrl = memberResult[0]?.avatarUrl ?? null;
      inboxBadge = badgeResult[0]?.count ?? 0;
      clinicName = clinicResult[0]?.name ?? clinicName;
    } catch {
      // fallback silencioso
    }
  }

  return (
    <div className="clinic-layout">
      <SidebarNav
        email={session?.email}
        avatarUrl={avatarUrl}
        inboxBadge={inboxBadge}
        isOwner={session?.role === "owner"}
        clinicName={clinicName}
      />
      <main style={{ minWidth: 0, overflowX: "hidden" }}>{children}</main>
      <NavigationPerformanceReporter enabled={process.env.PERFORMANCE_TELEMETRY_ENABLED === "1"} />
      <PushNotificationSetup />
    </div>
  );
}
