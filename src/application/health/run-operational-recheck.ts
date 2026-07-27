import { eq } from "drizzle-orm";
import { probeClinicChannelHealth } from "@/application/health/channel-health";
import { detectDailyMetricAlerts } from "@/application/health/daily-metric-alerts";
import { MetricsAggregator } from "@/core/intelligence/MetricsAggregator";
import { db } from "@/infrastructure/db/client";
import { clinicMetrics, organizations } from "@/infrastructure/db/schema";

type RecheckClinicRow = {
  clinicId: string;
  clinicName: string;
  operationalStatus: "prospect" | "test" | "active" | "paused" | "cancelled";
  channelProvider: "z_api" | "meta_cloud_api" | null;
  zapiInstanceId: string | null;
  zapiToken: string | null;
  zapiClientToken: string | null;
  metaPhoneNumberId: string | null;
  metaAccessToken: string | null;
  metaAppSecret: string | null;
};

export type OperationalRecheckItem = {
  clinicId: string;
  clinicName: string;
  status: "ok" | "error";
  snapshotAlertCount: number;
  channelStatus: "healthy" | "degraded" | "unknown";
  channelDetail: string | null;
  error?: string;
};

export type OperationalRecheckResult = {
  processedCount: number;
  failedCount: number;
  channelDegradedCount: number;
  snapshotAlertCount: number;
  clinics: OperationalRecheckItem[];
};

async function loadTargetClinics(
  clinicId?: string,
): Promise<RecheckClinicRow[]> {
  const rows = await db
    .select({
      clinicId: organizations.id,
      clinicName: organizations.name,
      operationalStatus: organizations.operationalStatus,
      channelProvider: organizations.channelProvider,
      zapiInstanceId: organizations.zapiInstanceId,
      zapiToken: organizations.zapiToken,
      zapiClientToken: organizations.zapiClientToken,
      metaPhoneNumberId: organizations.metaPhoneNumberId,
      metaAccessToken: organizations.metaAccessToken,
      metaAppSecret: organizations.metaAppSecret,
    })
    .from(organizations)
    .where(clinicId ? eq(organizations.id, clinicId) : eq(organizations.operationalStatus, "active"));

  if (clinicId && rows.length === 0) {
    throw new Error("Clínica não encontrada");
  }

  return rows.filter((clinic) => clinic.operationalStatus === "active");
}

export async function runOperationalRecheck(input?: {
  clinicId?: string;
}): Promise<OperationalRecheckResult> {
  const targetClinics = await loadTargetClinics(input?.clinicId);

  if (input?.clinicId && targetClinics.length === 0) {
    throw new Error("A clínica precisa estar ativa para rodar o recheck");
  }

  const aggregator = new MetricsAggregator();
  const results: OperationalRecheckItem[] = [];

  for (const clinic of targetClinics) {
    const channelStatus = await probeClinicChannelHealth(clinic);

    try {
      const metrics = await aggregator.aggregate(clinic.clinicId, 1);
      const alerts = detectDailyMetricAlerts({
        unclearRate: metrics.unclearRate,
        needsHumanRate: metrics.needsHumanRate,
        totalConversations: metrics.totalConversations,
      });

      await db.insert(clinicMetrics).values({
        clinicId: clinic.clinicId,
        periodFrom: metrics.period.from,
        periodTo: metrics.period.to,
        data: {
          ...(metrics as unknown as Record<string, unknown>),
          periodDays: 1,
          alerts,
        },
      });

      results.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        status: "ok",
        snapshotAlertCount: alerts.length,
        channelStatus: channelStatus.status,
        channelDetail: channelStatus.detail,
      });
    } catch (error) {
      results.push({
        clinicId: clinic.clinicId,
        clinicName: clinic.clinicName,
        status: "error",
        snapshotAlertCount: 0,
        channelStatus: channelStatus.status,
        channelDetail: channelStatus.detail,
        error: error instanceof Error ? error.message : "Erro ao recalcular métricas",
      });
    }
  }

  return {
    processedCount: results.filter((item) => item.status === "ok").length,
    failedCount: results.filter((item) => item.status === "error").length,
    channelDegradedCount: results.filter(
      (item) => item.channelStatus === "degraded",
    ).length,
    snapshotAlertCount: results.reduce(
      (sum, item) => sum + item.snapshotAlertCount,
      0,
    ),
    clinics: results,
  };
}
