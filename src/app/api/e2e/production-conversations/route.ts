import { NextRequest, NextResponse } from "next/server";
import { e2eGuard } from "../_guard";

/**
 * Desativado deliberadamente.
 *
 * Esta rota devolvia texto e IDs brutos de conversas reais para um consumidor
 * externo. Mesmo protegida por E2E_SECRET, criava uma superfície de exfiltração
 * de dados pessoais e permitia que conteúdo real acabasse em logs/artefatos de
 * CI. O corpus novo será produzido por um exportador interno, anonimizado antes
 * de atravessar a fronteira do SystemOps.
 */
export async function GET(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  return NextResponse.json(
    {
      error: "production_conversation_export_disabled",
      replacement: "sanitized_replay_corpus_exporter",
    },
    { status: 410 },
  );
}
