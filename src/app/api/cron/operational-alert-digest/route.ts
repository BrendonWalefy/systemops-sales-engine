import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { organizations, clinicMetrics, playbookVersions } from "@/infrastructure/db/schema";
import { appendOperationalAlerts, evaluateOperationalAlerts } from "@/application/health/operational-alerts";
import { probeClinicChannelHealth } from "@/application/health/channel-health";
import { inspectCreditBalances } from "@/application/health/credit-balance";
import { inspectQueueHealth, mapQueueHealthAlertsToOperationalAlerts } from "@/application/health/queue-health";
import { buildAlertDigestEmail } from "@/infrastructure/notifications/alert-email-template";
import { sendEmail } from "@/infrastructure/notifications/email-sender";
import { requireCronAuthorization } from "@/app/api/cron/_auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuthorization(req);
  if (unauthorized) return unauthorized;

  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    return NextResponse.json({ error: "OWNER_EMAIL not configured" }, { status: 500 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://app.systemops.com.br");

  const activeClinics = await db
    .select({
      clinicId: organizations.id,
      clinicName: organizations.name,
      operationalStatus: organizations.operationalStatus,
      isDemo: organizations.isDemo,
      channelProvider: organizations.channelProvider,
      zapiInstanceId: organizations.zapiInstanceId,
      zapiToken: organizations.zapiToken,
      zapiClientToken: organizations.zapiClientToken,
      metaPhoneNumberId: organizations.metaPhoneNumberId,
      metaAccessToken: organizations.metaAccessToken,
      metaAppSecret: organizations.metaAppSecret,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.operationalStatus, "active"),
        eq(organizations.isDemo, false),
      ),
    );

  const clinicIds = activeClinics.map((c) => c.clinicId);

  const [activePlaybooks, latestMetrics] = clinicIds.length
    ? await Promise.all([
        db
          .select({ clinicId: playbookVersions.clinicId })
          .from(playbookVersions)
          .where(
            and(
              inArray(playbookVersions.clinicId, clinicIds),
              eq(playbookVersions.status, "active"),
            ),
          ),
        db
          .select({
            clinicId: clinicMetrics.clinicId,
            createdAt: clinicMetrics.createdAt,
            data: clinicMetrics.data,
          })
          .from(clinicMetrics)
          .where(inArray(clinicMetrics.clinicId, clinicIds))
          .orderBy(desc(clinicMetrics.createdAt)),
      ])
    : [[], []];

  const playbookClinicIds = new Set(activePlaybooks.map((r) => r.clinicId));
  const latestMetricMap = new Map<string, Date>();
  for (const row of latestMetrics) {
    if (!latestMetricMap.has(row.clinicId)) {
      latestMetricMap.set(row.clinicId, row.createdAt);
    }
  }

  const clinicsWithChannelStatus = await Promise.all(
    activeClinics.map(async (clinic) => ({
      ...clinic,
      channelStatus: await probeClinicChannelHealth(clinic),
    })),
  );

  const [queueHealth, creditAlerts] = await Promise.all([
    inspectQueueHealth(),
    inspectCreditBalances(),
  ]);
  const clinicAlertReport = evaluateOperationalAlerts(
    clinicsWithChannelStatus.map((clinic) => {
      const latestMetric = latestMetrics.find((r) => r.clinicId === clinic.clinicId);
      return {
        ...clinic,
        hasActivePlaybook: playbookClinicIds.has(clinic.clinicId),
        latestMetricAt: latestMetricMap.get(clinic.clinicId) ?? null,
        latestMetricData:
          latestMetric && typeof latestMetric.data === "object"
            ? (latestMetric.data as {
                totalConversations?: number | null;
                alerts?: Array<{
                  metric: string;
                  value: number;
                  threshold: number;
                  level: "warn" | "critical";
                }> | null;
              })
            : null,
      };
    }),
    new Date(),
  );
  const alertReport = appendOperationalAlerts(clinicAlertReport, [
    ...mapQueueHealthAlertsToOperationalAlerts(queueHealth.alerts),
    ...creditAlerts,
  ]);

  if (alertReport.alertCount === 0) {
    return NextResponse.json({
      sent: false,
      reason: "no_alerts",
      activeClinicCount: alertReport.activeClinicCount,
    });
  }

  const dashboardUrl = `${appUrl}/owner`;
  const { subject, html } = buildAlertDigestEmail(alertReport, dashboardUrl);
  const result = await sendEmail({ to: ownerEmail, subject, html });

  if (!result.ok) {
    console.error("[operational-alert-digest] Falha ao enviar email:", result.error);
    return NextResponse.json(
      { sent: false, error: result.error, alerts: alertReport.alertCount },
      { status: 500 },
    );
  }

  console.log(
    `[operational-alert-digest] Digest enviado para ${ownerEmail} — ` +
      `${alertReport.criticalCount} crítico(s), ${alertReport.warnCount} aviso(s)`,
  );

  return NextResponse.json({
    sent: true,
    emailId: result.id,
    activeClinicCount: alertReport.activeClinicCount,
    criticalAlerts: alertReport.criticalCount,
    warnAlerts: alertReport.warnCount,
  });
}
