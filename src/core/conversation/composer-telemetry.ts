import type { ComposedResponse } from "@/core/intelligence/ResponseComposer";
import type { DecisionTraceMetadata } from "@/core/observability/DecisionTrace";

/**
 * Telemetria da invocação do composer, para o estágio `response.validated`.
 *
 * Sem ela o trace responde "a resposta foi válida?" e nunca "válida sob qual
 * modelo?". Quando um alias da OpenAI muda de default, ou quando o custo por
 * turno sobe, o trace de ontem não distingue deriva de modelo de deriva de
 * prompt — e a comparação V1×V2 herdaria essa cegueira.
 *
 * Todos os cinco campos são identificadores técnicos ou números. Nenhum carrega
 * texto do lead, da clínica ou da resposta: a função lê só metadados de
 * `ComposedResponse` e ignora `text`, `parts` e `mediaIds` de propósito.
 */
export function buildComposerTelemetryMetadata(input: {
  response: Pick<
    ComposedResponse,
    "model" | "promptVersion" | "inputTokens" | "outputTokens"
  >;
  latencyMs: number;
}): DecisionTraceMetadata {
  return {
    model: input.response.model,
    promptVersion: input.response.promptVersion,
    inputTokens: input.response.inputTokens,
    outputTokens: input.response.outputTokens,
    latencyMs: input.latencyMs,
  };
}
