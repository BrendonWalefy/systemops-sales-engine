// Cron diário (8h UTC) — agrega métricas das últimas 24h por clínica e loga alertas.
// Reutiliza MetricsAggregator(days=1) e persiste em clinic_metrics para a UI /owner/qualidade.

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics, clinicMetrics } from "@/infrastructure/db/schema";
import { MetricsAggregator } from "@/core/intelligence/MetricsAggregator";

export const dynamic = "force-dynamic";

// Limites para alertas — ajustáveis sem migration
const ALERT_UNCLEAR_RATE = 0.2; // >20% de respostas unclear
const ALERT_TAKEOVER_RATE = 0.3; // >30% de conversas com needs_human
const ALERT_MIN_CONVERSATIONS = 1; // 0 conversas em 24h = possível outage Z-API

type AlertLevel = "warn" | "critical";

type DailyAlert = {
  metric: string;
  value: number;
  threshold: number;
  level: AlertLevel;
};

function detectAlerts(
  clinicName: string,
  clinicIdArg: string,
  unclearRate: number,
  needsHumanRate: number,
  totalConversations: number,
): DailyAlert[] {
  const alerts: DailyAlert[] = [];

  if (totalConversations < ALERT_MIN_CONVERSATIONS) {
    alerts.push({
      metric: "total_conversations",
      value: totalConversations,
      threshold: ALERT_MIN_CONVERSATIONS,
      level: "critical",
    });
    console.warn(
      `[analytics] 🚨 CRITICAL clinicId=${clinicIdArg} name="${clinicName}" total_conversations=0 — possível outage Z-API`,
    );
  }

  if (unclearRate > ALERT_UNCLEAR_RATE) {
    alerts.push({
      metric: "unclear_rate",
      value: unclearRate,
      threshold: ALERT_UNCLEAR_RATE,
      level: "warn",
    });
    console.warn(
      `[analytics] ⚠️  WARN clinicId=${clinicIdArg} name="${clinicName}" unclear_rate=${(unclearRate * 100).toFixed(1)}% (limite: ${ALERT_UNCLEAR_RATE * 100}%)`,
    );
  }

  if (needsHumanRate > ALERT_TAKEOVER_RATE) {
    alerts.push({
      metric: "needs_human_rate",
      value: needsHumanRate,
      threshold: ALERT_TAKEOVER_RATE,
      level: "warn",
    });
    console.warn(
      `[analytics] ⚠️  WARN clinicId=${clinicIdArg} name="${clinicName}" needs_human_rate=${(needsHumanRate * 100).toFixed(1)}% (limite: ${ALERT_TAKEOVER_RATE * 100}%)`,
    );
  }

  return alerts;
}

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
    alerts?: DailyAlert[];
    error?: string;
  }> = [];

  for (const clinic of activeClinics) {
    try {
      const metrics = await aggregator.aggregate(clinic.id, 1);

      const alerts = detectAlerts(
        clinic.name,
        clinic.id,
        metrics.unclearRate,
        metrics.needsHumanRate,
        metrics.totalConversations,
      );

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
