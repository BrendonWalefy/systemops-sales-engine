// Motor de Reativação (ADR-009), Fase 1.
//
// Cron diário que descobre POR QUE cada lead não fechou, lendo a conversa e
// gravando o motivo com o trecho que o sustenta (tabela `lead_outcomes`).
//
// NÃO ENVIA NENHUMA MENSAGEM. É análise. O disparo de campanha entra na Fase 3
// e passa obrigatoriamente pela outbox + Safety Gate, como toda saída do sistema.

import { NextRequest, NextResponse } from "next/server";
import { listAllClinicIds } from "@/application/tenancy/resolve-clinic";
import { classifyLeadOutcomesForClinic } from "@/application/reactivation/classify-lead-outcomes";
import { requireCronAuthorization } from "@/app/api/cron/_auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const unauthorized = requireCronAuthorization(request);
  if (unauthorized) return unauthorized;

  const clinicIds = await listAllClinicIds();
  const results = [];

  for (const clinicId of clinicIds) {
    // Uma clínica com erro não pode impedir as demais de rodar.
    try {
      results.push(await classifyLeadOutcomesForClinic(clinicId));
    } catch (err: unknown) {
      console.error(
        `[LeadOutcome] clínica falhou clinic=${clinicId}:`,
        err instanceof Error ? err.message : String(err),
      );
      results.push({
        clinicId,
        classified: 0,
        skipped: 0,
        failed: 0,
        budgetExhausted: false,
        spentUsdMicros: 0,
      });
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      classified: acc.classified + r.classified,
      skipped: acc.skipped + r.skipped,
      failed: acc.failed + r.failed,
    }),
    { classified: 0, skipped: 0, failed: 0 },
  );

  console.log(
    `[LeadOutcome] clinics=${results.length} classified=${totals.classified} skipped=${totals.skipped} failed=${totals.failed}`,
  );

  return NextResponse.json({ clinics: results.length, ...totals, perClinic: results });
}
