import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, gt, isNull, desc } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { treatmentGapReports, clinicOperationalInsights } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";

export const dynamic = "force-dynamic";

export type OperationalInsight = {
  key: string;
  type: string;
  category: "operational" | "ai_quality";
  title: string;
  description: string;
  affectedCount: number;
};

// GET /api/clinic/operational-insights
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();

  const [gapRows, insightRows] = await Promise.all([
    db
      .select({
        mentionedText: treatmentGapReports.mentionedText,
        count: count(treatmentGapReports.id),
      })
      .from(treatmentGapReports)
      .where(
        and(
          eq(treatmentGapReports.clinicId, clinicId),
          isNull(treatmentGapReports.resolvedAt),
        ),
      )
      .groupBy(treatmentGapReports.mentionedText)
      .orderBy(desc(count(treatmentGapReports.id)))
      .limit(3),

    db
      .select({
        id: clinicOperationalInsights.id,
        type: clinicOperationalInsights.type,
        category: clinicOperationalInsights.category,
        title: clinicOperationalInsights.title,
        description: clinicOperationalInsights.description,
        affectedCount: clinicOperationalInsights.affectedCount,
      })
      .from(clinicOperationalInsights)
      .where(
        and(
          eq(clinicOperationalInsights.clinicId, clinicId),
          isNull(clinicOperationalInsights.dismissedAt),
          gt(clinicOperationalInsights.expiresAt, now),
        ),
      )
      .orderBy(desc(clinicOperationalInsights.affectedCount))
      .limit(6),
  ]);

  const insights: OperationalInsight[] = [
    ...insightRows.map((r) => ({
      key: `op::${r.id}`,
      type: r.type,
      category: (r.category === "ai_quality" ? "ai_quality" : "operational") as "operational" | "ai_quality",
      title: r.title,
      description: r.description,
      affectedCount: r.affectedCount,
    })),
    ...gapRows.map((r) => ({
      key: `missing_treatment::${r.mentionedText}`,
      type: "missing_treatment",
      category: "operational" as const,
      title: "Tratamento não cadastrado",
      description: `${r.count} ${r.count === 1 ? "lead mencionou" : "leads mencionaram"} "${r.mentionedText}" — considere adicioná-lo ao catálogo.`,
      affectedCount: r.count,
    })),
  ];

  return NextResponse.json({ insights });
}

// PATCH /api/clinic/operational-insights — descarta um insight pelo key
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const now = new Date();

  if (body.key.startsWith("missing_treatment::")) {
    const mentionedText = body.key.slice("missing_treatment::".length);
    await db
      .update(treatmentGapReports)
      .set({ resolvedAt: now })
      .where(
        and(
          eq(treatmentGapReports.clinicId, clinicId),
          eq(treatmentGapReports.mentionedText, mentionedText),
          isNull(treatmentGapReports.resolvedAt),
        ),
      );
  } else if (body.key.startsWith("op::")) {
    const id = body.key.slice("op::".length);
    await db
      .update(clinicOperationalInsights)
      .set({ dismissedAt: now })
      .where(
        and(
          eq(clinicOperationalInsights.id, id),
          eq(clinicOperationalInsights.clinicId, clinicId),
        ),
      );
  }

  return NextResponse.json({ ok: true });
}
