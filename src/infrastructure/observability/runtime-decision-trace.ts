import {
  DECISION_TRACE_SCHEMA_VERSION,
  noopDecisionTraceSink,
  type DecisionTraceRecord,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";
import { createLogger } from "@/infrastructure/logging/logger";

class StructuredLogDecisionTraceSink implements DecisionTraceSink {
  private readonly nextSequenceByTurn = new Map<string, number>();
  private readonly log = createLogger({ scope: "DecisionTrace" });

  record(record: DecisionTraceRecord): void {
    if (!this.nextSequenceByTurn.has(record.turnId) && this.nextSequenceByTurn.size >= 5_000) {
      const oldestTurnId = this.nextSequenceByTurn.keys().next().value;
      if (oldestTurnId) this.nextSequenceByTurn.delete(oldestTurnId);
    }
    const sequence = this.nextSequenceByTurn.get(record.turnId) ?? 0;
    this.nextSequenceByTurn.set(record.turnId, sequence + 1);
    this.log.info("decision_trace.event", {
      schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
      sequence,
      turnId: record.turnId,
      stage: record.stage,
      occurredAt: record.occurredAt,
      clinicId: record.clinicId,
      conversationId: record.conversationId,
      ...(record.metadata ?? {}),
    });
    if (
      record.stage === "delivery.sent" ||
      record.stage === "turn.failed" ||
      record.stage === "turn.ignored" ||
      (record.stage === "orchestrator.completed" && record.metadata?.replied === false)
    ) {
      this.nextSequenceByTurn.delete(record.turnId);
    }
  }
}

/**
 * Captura desligada por padrão. O modo structured_log só registra metadados
 * explicitamente fornecidos pelos call sites; nunca corpo, prompt ou telefone.
 */
export function createRuntimeDecisionTraceSink(
  mode = process.env.DECISION_TRACE_MODE,
): DecisionTraceSink {
  return mode === "structured_log"
    ? new StructuredLogDecisionTraceSink()
    : noopDecisionTraceSink;
}
