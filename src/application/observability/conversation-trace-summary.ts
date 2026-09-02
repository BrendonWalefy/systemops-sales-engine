import type {
  DecisionTraceEventV1,
  DecisionTraceMetadata,
  DecisionTraceStage,
} from "@/core/observability/DecisionTrace";

export const CONVERSATION_TRACE_SUMMARY_VERSION =
  "conversation-trace-summary.v1" as const;

export type ConversationTraceInputEvent = DecisionTraceEventV1;

export type ConversationTraceTurnStatus =
  | "sent"
  | "ignored"
  | "failed"
  | "pending_delivery"
  | "processing";

export type ConversationTraceTurnSummary = Readonly<{
  turnId: string;
  status: ConversationTraceTurnStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  request: string | null;
  capabilityIds: readonly string[];
  decisionKinds: readonly string[];
  outcomeTypes: readonly string[];
  semanticClasses: readonly string[];
  responseStrategy: string | null;
  validationViolations: readonly string[];
  rejectionCodes: readonly string[];
  evidenceCaptureStatus: string | null;
  handoffReason: string | null;
  terminalReason: string | null;
  failurePhase: string | null;
  outboundCategory: string | null;
  authorizationKind: string | null;
  timeline: readonly Readonly<{
    stage: DecisionTraceStage;
    occurredAt: string;
    sequence: number;
  }>[];
}>;

export type ConversationTraceSummaryV1 = Readonly<{
  schemaVersion: typeof CONVERSATION_TRACE_SUMMARY_VERSION;
  turnCount: number;
  turns: readonly ConversationTraceTurnSummary[];
}>;

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareEvents(
  left: ConversationTraceInputEvent,
  right: ConversationTraceInputEvent,
): number {
  const leftTime = timestamp(left.occurredAt);
  const rightTime = timestamp(right.occurredAt);
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (leftTime !== null && rightTime === null) return -1;
  if (leftTime === null && rightTime !== null) return 1;
  return left.sequence - right.sequence;
}

function metadataString(
  metadata: DecisionTraceMetadata | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataList(
  metadata: DecisionTraceMetadata | undefined,
  key: string,
): readonly string[] {
  const value = metadataString(metadata, key);
  if (!value) return Object.freeze([]);
  return Object.freeze(
    [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))],
  );
}

function latestMetadataString(
  events: readonly ConversationTraceInputEvent[],
  stage: DecisionTraceStage,
  key: string,
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.stage !== stage) continue;
    const value = metadataString(event.metadata, key);
    if (value) return value;
  }
  return null;
}

function latestMetadataList(
  events: readonly ConversationTraceInputEvent[],
  stage: DecisionTraceStage,
  key: string,
): readonly string[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.stage !== stage) continue;
    const value = metadataList(event.metadata, key);
    if (value.length > 0) return value;
  }
  return Object.freeze([]);
}

function turnStatus(events: readonly ConversationTraceInputEvent[]): ConversationTraceTurnStatus {
  const stages = new Set(events.map(({ stage }) => stage));
  // Provider acceptance remains the durable truth even if acknowledgement later fails.
  if (stages.has("delivery.sent")) return "sent";
  if (stages.has("turn.failed")) return "failed";
  if (stages.has("turn.ignored")) return "ignored";
  if (stages.has("outbound.enqueued") || stages.has("v2.outbox")) {
    return "pending_delivery";
  }
  return "processing";
}

function summarizeTurn(
  turnId: string,
  unordered: readonly ConversationTraceInputEvent[],
): ConversationTraceTurnSummary {
  const events = [...unordered].sort(compareEvents);
  const validTimes = events
    .map(({ occurredAt }) => timestamp(occurredAt))
    .filter((value): value is number => value !== null);
  const startedAt = validTimes.length > 0
    ? new Date(Math.min(...validTimes)).toISOString()
    : null;
  const completedAt = validTimes.length > 0
    ? new Date(Math.max(...validTimes)).toISOString()
    : null;

  return Object.freeze({
    turnId,
    status: turnStatus(events),
    startedAt,
    completedAt,
    durationMs: startedAt && completedAt
      ? Math.max(0, Date.parse(completedAt) - Date.parse(startedAt))
      : null,
    request: latestMetadataString(events, "v2.understanding", "request"),
    capabilityIds: latestMetadataList(events, "v2.decision", "capabilityIds"),
    decisionKinds: latestMetadataList(events, "v2.decision", "decisionKinds"),
    outcomeTypes: latestMetadataList(events, "v2.action_result", "outcomeTypes"),
    semanticClasses: latestMetadataList(events, "v2.action_result", "semanticClasses"),
    responseStrategy: latestMetadataString(events, "response.validated", "responseStrategy"),
    validationViolations: latestMetadataList(events, "response.validated", "violations"),
    rejectionCodes: Object.freeze([
      ...new Set([
        ...latestMetadataList(events, "v2.understanding", "rejectionCodes"),
        ...latestMetadataList(events, "response.validated", "rejectionCodes"),
      ]),
    ]),
    evidenceCaptureStatus:
      latestMetadataString(events, "response.validated", "evidenceCaptureStatus")
      ?? latestMetadataString(events, "v2.understanding", "evidenceCaptureStatus"),
    handoffReason: latestMetadataString(events, "v2.action_result", "handoffReason"),
    terminalReason:
      latestMetadataString(events, "turn.failed", "reason")
      ?? latestMetadataString(events, "turn.ignored", "reason"),
    failurePhase: latestMetadataString(events, "turn.failed", "phase"),
    outboundCategory: latestMetadataString(events, "outbound.enqueued", "category"),
    authorizationKind: latestMetadataString(events, "outbound.enqueued", "authorizationKind"),
    timeline: Object.freeze(events.map(({ stage, occurredAt, sequence }) => Object.freeze({
      stage,
      occurredAt,
      sequence,
    }))),
  });
}

export function buildConversationTraceSummary(
  events: readonly ConversationTraceInputEvent[],
): ConversationTraceSummaryV1 {
  const byTurn = new Map<string, ConversationTraceInputEvent[]>();
  for (const event of events) {
    const existing = byTurn.get(event.turnId) ?? [];
    existing.push(event);
    byTurn.set(event.turnId, existing);
  }

  const turns = [...byTurn.entries()]
    .map(([turnId, turnEvents]) => summarizeTurn(turnId, turnEvents))
    .sort((left, right) => {
      const leftTime = left.completedAt ? Date.parse(left.completedAt) : 0;
      const rightTime = right.completedAt ? Date.parse(right.completedAt) : 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return right.turnId.localeCompare(left.turnId);
    });

  return Object.freeze({
    schemaVersion: CONVERSATION_TRACE_SUMMARY_VERSION,
    turnCount: turns.length,
    turns: Object.freeze(turns),
  });
}
