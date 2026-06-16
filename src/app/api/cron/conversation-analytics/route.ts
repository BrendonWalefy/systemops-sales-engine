// Cron diário (8h UTC) — agrega métricas das últimas 24h por clínica e loga alertas.
// Reutiliza MetricsAggregator(days=1) e persiste em clinic_metrics para a UI /owner/qualidade.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  DAILY_ALERT_MIN_CONVERSATIONS,
  DAILY_ALERT_TAKEOVER_RATE,
  DAILY_ALERT_UNCLEAR_RATE,
  detectDailyMetricAlerts,
  type DailyMetricAlert,
} from "@/application/health/daily-metric-alerts";
import { db } from "@/infrastructure/db/client";
import { clinics, clinicMetrics } from "@/infrastructure/db/schema";
import { MetricsAggregator } from "@/core/intelligence/MetricsAggregator";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const activeClinics = await db
    .select({ id: clinics.id, name: clinics.name })
    .from(clinics)
    .where(eq(clinics.operationalStatus, "active"));

  const aggregator = new MetricsAggregator();
  const results: Array<{
    clinicId: string;
    name: string;
    status: "ok" | "error";
    totalConversations?: number;
    unclearRate?: number;
    needsHumanRate?: number;
    conversionRate?: number;
    alerts?: DailyMetricAlert[];
    error?: string;
  }> = [];

  for (const clinic of activeClinics) {
    try {
      const metrics = await aggregator.aggregate(clinic.id, 1);

      const alerts = detectDailyMetricAlerts({
        unclearRate: metrics.unclearRate,
        needsHumanRate: metrics.needsHumanRate,
        totalConversations: metrics.totalConversations,
      });

      alerts.forEach((alert) => {
        if (alert.metric === "total_conversations") {
          console.warn(
            `[analytics] 🚨 CRITICAL clinicId=${clinic.id} name="${clinic.name}" total_conversations=0 (mínimo: ${DAILY_ALERT_MIN_CONVERSATIONS})`,
          );
        }

        if (alert.metric === "unclear_rate") {
          console.warn(
            `[analytics] ⚠️  WARN clinicId=${clinic.id} name="${clinic.name}" unclear_rate=${(metrics.unclearRate * 100).toFixed(1)}% (limite: ${DAILY_ALERT_UNCLEAR_RATE * 100}%)`,
          );
        }

        if (alert.metric === "needs_human_rate") {
          console.warn(
            `[analytics] ⚠️  WARN clinicId=${clinic.id} name="${clinic.name}" needs_human_rate=${(metrics.needsHumanRate * 100).toFixed(1)}% (limite: ${DAILY_ALERT_TAKEOVER_RATE * 100}%)`,
          );
        }
      });

      await db.insert(clinicMetrics).values({
        clinicId: clinic.id,
        periodFrom: metrics.period.from,
        periodTo: metrics.period.to,
        data: {
          ...(metrics as unknown as Record<string, unknown>),
          periodDays: 1,
          alerts,
        },
      });

      results.push({
        clinicId: clinic.id,
        name: clinic.name,
        status: "ok",
        totalConversations: metrics.totalConversations,
        unclearRate: metrics.unclearRate,
        needsHumanRate: metrics.needsHumanRate,
        conversionRate: metrics.conversionRate,
        alerts,
      });

      console.log(
        `[analytics] clinicId=${clinic.id} name="${clinic.name}" conversations=${metrics.totalConversations} unclear=${(metrics.unclearRate * 100).toFixed(1)}% needsHuman=${(metrics.needsHumanRate * 100).toFixed(1)}% conversion=${(metrics.conversionRate * 100).toFixed(1)}%`,
      );
    } catch (err) {
      console.error(`[analytics] ERRO clinicId=${clinic.id}`, err);
      results.push({
        clinicId: clinic.id,
        name: clinic.name,
        status: "error",
        error: String(err),
      });
    }
  }

  const totalAlerts = results.flatMap((r) => r.alerts ?? []).length;
  console.log(
    `[analytics] Concluído: ${activeClinics.length} clínica(s), ${totalAlerts} alerta(s)`,
  );

  return NextResponse.json({
    processed: results.length,
    alerts: totalAlerts,
    results,
  });
}
