import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  clinicMetrics,
  playbookVersions,
} from "@/infrastructure/db/schema";
import { evaluateClinicHealth } from "@/application/health/clinic-health";
import { evaluateOperationalAlerts } from "@/application/health/operational-alerts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const activeClinics = await db
      .select({
        clinicId: clinics.id,
        clinicName: clinics.name,
        operationalStatus: clinics.operationalStatus,
        channelProvider: clinics.channelProvider,
        zapiInstanceId: clinics.zapiInstanceId,
        zapiToken: clinics.zapiToken,
        metaPhoneNumberId: clinics.metaPhoneNumberId,
        metaAccessToken: clinics.metaAccessToken,
      })
      .from(clinics)
      .where(eq(clinics.operationalStatus, "active"));

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

    const report = evaluateClinicHealth(
      activeClinics.map((clinic) => ({
        ...clinic,
        hasActivePlaybook: playbookClinicIds.has(clinic.clinicId),
        latestMetricAt: latestMetricMap.get(clinic.clinicId) ?? null,
      })),
      new Date(),
    );
    const alertReport = evaluateOperationalAlerts(
      activeClinics.map((clinic) => {
        const latestMetric = latestMetrics.find(
          (row) => row.clinicId === clinic.clinicId,
        );

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
        alerts: alertReport.alerts,
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
