import {
  DECISION_TRACE_SCHEMA_VERSION,
  hasResponseDecisionTraceMetadataContract,
  noopDecisionTraceSink,
  sanitizeResponseDecisionTraceRecord,
  type DecisionTraceMetadata,
  type DecisionTraceRecord,
  type DecisionTraceSink,
} from "@/core/observability/DecisionTrace";
import { createLogger } from "@/infrastructure/logging/logger";
import {
  DrizzleDecisionTraceStore,
  type DecisionTraceBatchStore,
} from "@/infrastructure/repositories/drizzle-decision-trace-store";

const TRACE_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MAX_BUFFERED_TURNS = 5_000;
const MAX_EVENTS_PER_TURN = 40;

const PERSISTED_METADATA_KEYS = new Set([
  "action", "activeModuleCount", "agentMessageId", "applied",
  "attempt", "automationMode", "canonicalTreatmentId",
  "canonicalTreatmentName", "category", "classifiedIntent",
  "classifierOverridden", "clinicConfigUpdatedAt", "coercedIntent", "commercialPauseDetected",
  "confidence", "configFieldCount", "configFingerprint", "configFingerprintSchema",
  "contentType", "deterministic", "errorName",
  "expectedStepIndex", "expectedTreatmentId", "finalIntent", "hasActiveEditorial",
  "hasPipeline", "hasPendingOffer", "hasResetBoundary", "hasText",
  "intent", "interleavedPartCount", "isConversationOpening", "jobWasNew",
  "leadMessageCount", "mediaAssetCount", "mediaPartCount", "mediaType",
  "messageWasNew", "normalizedIntent", "observationOnly", "outboundMessageId",
  "overrideCount", "overrideRules",
  "pendingPipelineAdvance", "phase", "pipelineActive", "pipelineAdvanceApplied",
  "pipelineStepIndex", "pipelineTreatmentId", "playbookVersionId", "procedureCount", "provider",
  "providerAccepted", "queue", "reason", "replay", "replied", "replyEnabled",
  "segment", "selectedTreatmentId", "selectedTreatmentName", "skipLlm", "source",
  "state", "timezone", "useVoice",
]);

class StructuredLogDecisionTraceSink implements DecisionTraceSink {
  private readonly nextSequenceByTurn = new Map<string, number>();
  private readonly log = createLogger({ scope: "DecisionTrace" });

  record(record: DecisionTraceRecord): void {
    evictOldestTurn(this.nextSequenceByTurn);
    const sequence = this.nextSequenceByTurn.get(record.turnId) ?? 0;
    this.nextSequenceByTurn.set(record.turnId, sequence + 1);
    this.log.info("decision_trace.event", {
      schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
      sequence,
      ...sanitizeDecisionTraceRecord(record),
    });
    if (isFlushStage(record)) this.nextSequenceByTurn.delete(record.turnId);
  }
}

export class BufferedDatabaseDecisionTraceSink implements DecisionTraceSink {
  private readonly buffers = new Map<string, DecisionTraceRecord[]>();

  constructor(
    private readonly store: DecisionTraceBatchStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(record: DecisionTraceRecord): Promise<void> {
    evictOldestTurn(this.buffers);
    const sanitized = sanitizeDecisionTraceRecord(record);
    const events = this.buffers.get(record.turnId) ?? [];
    if (events.length < MAX_EVENTS_PER_TURN) {
      events.push(sanitized);
    } else if (isFlushStage(record)) {
      // Preserve the terminal outcome even if an unexpectedly noisy turn hits
      // the cap. The previous event is less useful than knowing how it ended.
      events[MAX_EVENTS_PER_TURN - 1] = sanitized;
    }
    this.buffers.set(record.turnId, events);
    if (isFlushStage(record)) await this.flush(record.turnId);
  }

  private async flush(turnId: string): Promise<void> {
    const events = this.buffers.get(turnId) ?? [];
    if (events.length === 0) return;
    const clinicId = [...events].reverse().find((event) => event.clinicId)?.clinicId;
    if (!clinicId) {
      this.buffers.delete(turnId);
      return;
    }
    const conversationId =
      [...events].reverse().find((event) => event.conversationId)?.conversationId ?? null;
    this.buffers.delete(turnId);
    await this.store.append({
      turnId,
      clinicId,
      conversationId,
      events,
      expiresAt: new Date(this.now().getTime() + TRACE_RETENTION_MS),
    });
  }
}

export function sanitizeDecisionTraceRecord(
  record: DecisionTraceRecord,
): DecisionTraceRecord {
  const responseRecord = sanitizeResponseDecisionTraceRecord(record);
  const metadata = Object.fromEntries(
    Object.entries(responseRecord.metadata ?? {}).filter(([key]) =>
      hasResponseDecisionTraceMetadataContract(record.stage) ||
      PERSISTED_METADATA_KEYS.has(key),
    ),
  ) as DecisionTraceMetadata;
  return {
    turnId: record.turnId,
    stage: record.stage,
    occurredAt: record.occurredAt,
    ...(record.clinicId ? { clinicId: record.clinicId } : {}),
    ...(record.conversationId ? { conversationId: record.conversationId } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function isFlushStage(record: DecisionTraceRecord): boolean {
  return (
    record.stage === "orchestrator.completed" ||
    record.stage === "delivery.sent" ||
    record.stage === "turn.failed" ||
    record.stage === "turn.ignored"
  );
}

function evictOldestTurn(map: Map<string, unknown>): void {
  if (map.size < MAX_BUFFERED_TURNS) return;
  const oldestTurnId = map.keys().next().value;
  if (oldestTurnId) map.delete(oldestTurnId);
}

/**
 * Banco sanitizado é o padrão para permitir diagnóstico posterior. Use
 * DECISION_TRACE_MODE=off para desligar ou structured_log para logs efêmeros.
 */
export function createRuntimeDecisionTraceSink(
  mode = process.env.DECISION_TRACE_MODE ?? "database",
): DecisionTraceSink {
  if (mode === "database") {
    return new BufferedDatabaseDecisionTraceSink(
      new DrizzleDecisionTraceStore(),
    );
  }
  return mode === "structured_log"
    ? new StructuredLogDecisionTraceSink()
    : noopDecisionTraceSink;
}
