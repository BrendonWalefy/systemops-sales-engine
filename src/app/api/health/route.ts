import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  clinicMetrics,
  playbookVersions,
} from "@/infrastructure/db/schema";
import { evaluateClinicHealth } from "@/application/health/clinic-health";
import { appendOperationalAlerts, evaluateOperationalAlerts } from "@/application/health/operational-alerts";
import { probeClinicChannelHealth } from "@/application/health/channel-health";
import { inspectQueueHealth, mapQueueHealthAlertsToOperationalAlerts } from "@/application/health/queue-health";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
      })
      .from(organizations)
      .where(
        and(
          eq(organizations.operationalStatus, "active"),
          eq(organizations.isDemo, false),
        ),
      );

    const clinicIds = activeClinics.map((clinic) => clinic.clinicId);

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

    const playbookClinicIds = new Set(
      activePlaybooks.map((row) => row.clinicId),
    );
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
        hasActivePlaybook: playbookClinicIds.has(clinic.clinicId),
        latestMetricAt: latestMetricMap.get(clinic.clinicId) ?? null,
      })),
    );

    const report = evaluateClinicHealth(
      clinicsWithChannelStatus,
      new Date(),
    );
    const queueHealth = await inspectQueueHealth();
    const clinicAlertReport = evaluateOperationalAlerts(
      clinicsWithChannelStatus.map((clinic) => {
        const latestMetric = latestMetrics.find(
          (row) => row.clinicId === clinic.clinicId,
        );

        return {
          ...clinic,
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
    const alertReport = appendOperationalAlerts(
      clinicAlertReport,
      mapQueueHealthAlertsToOperationalAlerts(queueHealth.alerts),
    );
    const overallStatus =
      report.status === "degraded" || alertReport.status === "degraded"
        ? "degraded"
        : "ok";

    return NextResponse.json(
      {
        ok: overallStatus === "ok",
        status: overallStatus,
        checkedAt: new Date().toISOString(),
        db: "ok",
        activeClinicCount: report.activeClinicCount,
        degradedClinicCount: report.degradedClinicCount,
        degradedClinics: report.degradedClinics,
        warnings: report.warnings,
        activeAlerts: alertReport.alertCount,
        criticalAlerts: alertReport.criticalCount,
        warnAlerts: alertReport.warnCount,
        channelStatuses: clinicsWithChannelStatus.map((clinic) => ({
          clinicId: clinic.clinicId,
          clinicName: clinic.clinicName,
          status: clinic.channelStatus?.status ?? "unknown",
          detail: clinic.channelStatus?.detail ?? null,
        })),
        alerts: alertReport.alerts,
        queueHealth,
      },
      { status: overallStatus === "ok" ? 200 : 503 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: "down",
        checkedAt: new Date().toISOString(),
        db: "error",
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 503 },
    );
  }
}
