import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, isNull, desc } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { treatmentGapReports } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";

export const dynamic = "force-dynamic";

// GET /api/clinic/treatment-gaps
// Retorna resumo dos tratamentos não cadastrados mencionados por leads.
// Agrupado por mentionedText para exibição como insight operacional no Inbox.
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
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
    .limit(5);

  return NextResponse.json({ gaps: rows });
}

// PATCH /api/clinic/treatment-gaps
// Marca todos os gaps de um tratamento específico como resolvidos.
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { mentionedText?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.mentionedText) {
    return NextResponse.json({ error: "mentionedText required" }, { status: 400 });
  }

  const now = new Date();
  await db
    .update(treatmentGapReports)
    .set({ resolvedAt: now })
    .where(
      and(
        eq(treatmentGapReports.clinicId, clinicId),
        eq(treatmentGapReports.mentionedText, body.mentionedText),
        isNull(treatmentGapReports.resolvedAt),
      ),
    );

  return NextResponse.json({ ok: true });
}
