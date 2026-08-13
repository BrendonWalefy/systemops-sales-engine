// Qual regra o composer violou precisa sobreviver ao trace.
//
// O replay de 13/08 mostrou que 24 de 52 turnos (46%) caem em
// `response.fallback_applied` com motivo `response_plan_violation`, e todos
// escalam para humano. Mas o trace só guardava `violationCount` — dá para saber
// QUANTAS regras quebraram, nunca QUAIS. Sem isso, a investigação para no
// "alguma coisa violou o plano".
//
// Os códigos são enum fechado (unauthorized_price, unauthorized_schedule_fact,
// ...), não texto de paciente — cabem no trace sem risco de PII.

import { describe, expect, it } from "vitest";
import {
  sanitizeResponseDecisionTraceRecord,
  type DecisionTraceRecord,
} from "@/core/observability/DecisionTrace";

const registro = (metadata: Record<string, string | number | boolean | null>): DecisionTraceRecord => ({
  turnId: "turn-1",
  stage: "response.validated",
  occurredAt: "2026-08-13T12:00:00.000Z",
  metadata,
});

describe("trace de validação", () => {
  it("preserva quais regras foram violadas, não só quantas", () => {
    const saneado = sanitizeResponseDecisionTraceRecord(registro({
      action: "general_question",
      valid: false,
      violationCount: 2,
      violations: "unauthorized_price,unauthorized_schedule_fact",
      requiresHandoff: true,
    }));

    expect(saneado.metadata?.violations).toBe(
      "unauthorized_price,unauthorized_schedule_fact",
    );
  });

  it("continua descartando chave fora do contrato", () => {
    // A allowlist filtra em silêncio; este teste garante que ela não virou peneira.
    const saneado = sanitizeResponseDecisionTraceRecord(registro({
      action: "general_question",
      valid: false,
      violationCount: 1,
      leadMessage: "texto livre do paciente",
    }));

    expect(saneado.metadata).not.toHaveProperty("leadMessage");
  });
});
