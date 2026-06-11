import { NextRequest, NextResponse } from "next/server";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { PlaybookAdvisor } from "@/core/intelligence/PlaybookAdvisor";
import type { ClinicMetrics } from "@/core/intelligence/MetricsAggregator";
import type { CurrentPlaybook } from "@/core/intelligence/PlaybookAdvisor";

export const dynamic = "force-dynamic";

// POST /api/playbook/advisor/analyze
// Body: { clinicId, metricsData, currentPlaybook }
// Returns: AdvisorResult
export async function POST(req: NextRequest) {
  try {
    // Sessão obrigatória e clinicId do body precisa ser o da sessão —
    // sem isso qualquer um na internet queimava custo de LLM via esta rota.
    const sessionClinicId = await getSessionClinicId();
    if (!sessionClinicId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json() as {
      clinicId: string;
      metricsData: Record<string, unknown>;
      currentPlaybook: CurrentPlaybook;
    };

    if (!body.clinicId || !body.metricsData || !body.currentPlaybook) {
      return NextResponse.json({ error: "clinicId, metricsData and currentPlaybook required" }, { status: 400 });
    }

    if (body.clinicId !== sessionClinicId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const metrics = body.metricsData as unknown as ClinicMetrics;
    const advisor = new PlaybookAdvisor();
    const result = await advisor.analyze(metrics, body.currentPlaybook);

    return NextResponse.json(result);
  } catch (err) {
    console.error("[playbook/advisor/analyze]", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
