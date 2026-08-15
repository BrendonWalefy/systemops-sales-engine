import { describe, expect, it } from "vitest";
import {
  RESPONSE_DECISION_TRACE_METADATA_KEYS,
  sanitizeResponseDecisionTraceRecord,
  type DecisionTraceRecord,
} from "@/core/observability/DecisionTrace";
import { buildComposerTelemetryMetadata } from "@/core/conversation/composer-telemetry";

// Sem isso o trace responde "a resposta foi válida?" mas nunca "válida sob qual
// modelo?". Quando a OpenAI muda o default de um alias, ou quando o custo por
// turno sobe, o trace de ontem não distingue deriva de modelo de deriva de
// prompt — e a comparação V1×V2 herda essa cegueira.
describe("metadata do trace de resposta", () => {
  it("preserva telemetria de LLM e descarta chave livre", () => {
    const out = sanitizeResponseDecisionTraceRecord({
      turnId: "turn-1",
      stage: "response.validated",
      occurredAt: new Date().toISOString(),
      metadata: {
        action: "price_inquiry",
        valid: true,
        model: "gpt-5.4-mini",
        promptVersion: "composer-v4-demo-quality",
        inputTokens: 1200,
        outputTokens: 180,
        latencyMs: 940,
        leadMessage: "texto livre com PII",
      },
    } as unknown as DecisionTraceRecord);

    expect(out.metadata).toMatchObject({
      model: "gpt-5.4-mini",
      promptVersion: "composer-v4-demo-quality",
      inputTokens: 1200,
      outputTokens: 180,
      latencyMs: 940,
    });
    expect(out.metadata).not.toHaveProperty("leadMessage");
  });

  it("a telemetria vive no estágio validated, não no plan_built", () => {
    // O plano é construído ANTES da chamada do composer — no plan_built ainda
    // não existe modelo, token nem latência para registrar.
    const planBuiltKeys = RESPONSE_DECISION_TRACE_METADATA_KEYS["response.plan_built"];
    expect(planBuiltKeys).not.toContain("model");
    expect(planBuiltKeys).not.toContain("latencyMs");
  });

  it("monta a metadata a partir da resposta composta, sem texto nenhum", () => {
    const metadata = buildComposerTelemetryMetadata({
      response: {
        model: "gpt-5.4-mini",
        promptVersion: "composer-v4-demo-quality",
        inputTokens: 1200,
        outputTokens: 180,
      },
      latencyMs: 940,
    });

    expect(metadata).toEqual({
      model: "gpt-5.4-mini",
      promptVersion: "composer-v4-demo-quality",
      inputTokens: 1200,
      outputTokens: 180,
      latencyMs: 940,
    });
    // O tipo do parâmetro nem aceita `text`/`parts`/`mediaIds`: a telemetria não
    // tem como carregar conteúdo da conversa, por construção e não por revisão.
    expect(Object.keys(metadata)).toEqual([
      "model", "promptVersion", "inputTokens", "outputTokens", "latencyMs",
    ]);
  });

  it("todas as chaves de telemetria estão na allowlist de validated", () => {
    const validatedKeys = RESPONSE_DECISION_TRACE_METADATA_KEYS["response.validated"];
    for (const key of ["model", "promptVersion", "inputTokens", "outputTokens", "latencyMs"]) {
      expect(validatedKeys).toContain(key);
    }
  });
});
