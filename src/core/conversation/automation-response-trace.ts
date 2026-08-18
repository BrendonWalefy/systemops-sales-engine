import type { PlannedResponse } from "@/core/conversation/ConversationResponsePlanner";
import { buildComposerTelemetryMetadata } from "@/core/conversation/composer-telemetry";
import { recordDecisionTrace, type DecisionTraceSink } from "@/core/observability/DecisionTrace";

/**
 * Emite `response.validated` para os caminhos de outbound automatizado que rodam
 * fora do `ConversationOrchestrator` — lembrete, follow-up e recuperação.
 *
 * Esses três aplicam plano e validador desde o Ciclo B, mas nenhum instanciava
 * sink de trace: turnos autônomos que o lead recebia não existiam em
 * `decision_traces`. Quando um lembrete saísse errado, a investigação começava e
 * terminava no log de uma invocação serverless já encerrada.
 *
 * Só identificadores técnicos e números. O texto da resposta não entra — a
 * telemetria vem de `buildComposerTelemetryMetadata`, cujo tipo de entrada nem
 * aceita `text`.
 */
export async function recordAutomationResponseTrace(
  sink: DecisionTraceSink,
  input: {
    turnId: string;
    clinicId: string;
    conversationId: string;
    planned: PlannedResponse;
  },
): Promise<void> {
  const { planned } = input;
  const traceBase = {
    turnId: input.turnId,
    occurredAt: new Date().toISOString(),
    clinicId: input.clinicId,
    conversationId: input.conversationId,
  };

  await recordDecisionTrace(sink, {
    ...traceBase,
    stage: "response.plan_built",
    metadata: {
      action: planned.plan.action,
      planVersion: planned.plan.version,
      allowedPriceCount: planned.plan.allowedPriceCents.length,
      allowedScheduleFactCount: planned.plan.allowedScheduleFacts.length,
      allowedMediaCount: planned.plan.allowedMediaIds.length,
      maxCharacters: planned.plan.maxCharacters,
      expectedState: planned.plan.expectedState,
    },
  });

  await recordDecisionTrace(sink, {
    ...traceBase,
    stage: "response.validated",
    metadata: {
      action: planned.plan.action,
      valid: planned.source === "composer",
      violationCount: planned.violations.length,
      violations: planned.violations.join(","),
      requiresHandoff: planned.requiresHandoff,
      ...buildComposerTelemetryMetadata({
        response: planned.response,
        latencyMs: planned.composerLatencyMs,
      }),
    },
  });

  if (planned.source === "deterministic_fallback") {
    await recordDecisionTrace(sink, {
      ...traceBase,
      stage: "response.fallback_applied",
      metadata: {
        action: planned.plan.action,
        fallbackReason: planned.fallbackReason,
        requiresHandoff: planned.requiresHandoff,
      },
    });
  }
}
