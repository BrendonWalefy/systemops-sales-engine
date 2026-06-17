import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { clinics, clinicMetrics } from "@/infrastructure/db/schema";
import { MetricsAggregator } from "@/core/intelligence/MetricsAggregator";
import { requireCronAuthorization } from "@/app/api/cron/_auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuthorization(req);
  if (unauthorized) return unauthorized;

  const activeClinics = await db
    .select({ id: clinics.id })
    .from(clinics)
    .where(eq(clinics.operationalStatus, "active"));

  const aggregator = new MetricsAggregator();
  const results: Array<{
    clinicId: string;
    status: "ok" | "error";
    error?: string;
  }> = [];

  for (const clinic of activeClinics) {
    try {
      const metrics = await aggregator.aggregate(clinic.id, 30);

      await db.insert(clinicMetrics).values({
        clinicId: clinic.id,
        periodFrom: metrics.period.from,
        periodTo: metrics.period.to,
        data: metrics as unknown as Record<string, unknown>,
      });

      results.push({ clinicId: clinic.id, status: "ok" });
    } catch (err) {
      console.error(`[metrics-aggregate] clinicId=${clinic.id}`, err);
      results.push({
        clinicId: clinic.id,
        status: "error",
        error: String(err),
      });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
