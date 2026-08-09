/**
 * Contrato neutro e versionado da trilha de decisão de um turno.
 *
 * A trilha registra decisões e referências, nunca o conteúdo bruto da conversa,
 * prompts, telefones ou outros dados pessoais. O sink é injetável para que o
 * runtime normal use noop e o replay capture a sequência completa em memória.
 */

export const DECISION_TRACE_SCHEMA_VERSION = "decision-trace.v1" as const;

export const DECISION_TRACE_STAGES = [
  "ingress.received",
  "ingress.content_resolved",
  "orchestrator.started",
  "tenant.config_loaded",
  "state.loaded",
  "intent.classified",
  "intent.resolved",
  "treatment.resolved",
  "response.plan_built",
  "response.validated",
  "response.fallback_applied",
  "state.before_delivery",
  "outbound.planned",
  "outbound.enqueued",
  "state.pipeline_committed",
  "orchestrator.completed",
  "delivery.started",
  "state.after_delivery",
  "delivery.sent",
  "turn.ignored",
  "turn.failed",
] as const;

export type DecisionTraceStage = typeof DECISION_TRACE_STAGES[number];

const DECISION_TRACE_STAGE_ALLOWLIST = new Set<string>(DECISION_TRACE_STAGES);

export const RESPONSE_DECISION_TRACE_METADATA_KEYS = {
  "response.plan_built": [
    "action",
    "planVersion",
    "allowedPriceCount",
    "allowedScheduleFactCount",
    "allowedMediaCount",
    "maxCharacters",
    "expectedState",
  ],
  "response.validated": [
    "action",
    "valid",
    "violationCount",
    "requiresHandoff",
  ],
  "response.fallback_applied": [
    "action",
    "fallbackReason",
    "requiresHandoff",
  ],
} as const satisfies Partial<Record<DecisionTraceStage, readonly string[]>>;

const RESPONSE_DECISION_TRACE_METADATA_KEY_SETS = Object.fromEntries(
  Object.entries(RESPONSE_DECISION_TRACE_METADATA_KEYS).map(([stage, keys]) => [
    stage,
    new Set<string>(keys),
  ]),
) as Partial<Record<DecisionTraceStage, ReadonlySet<string>>>;

export type DecisionTraceMetadataValue = string | number | boolean | null;
export type DecisionTraceMetadata = Readonly<Record<string, DecisionTraceMetadataValue>>;

export type DecisionTraceRecord = {
  turnId: string;
  stage: DecisionTraceStage;
  occurredAt: string;
  clinicId?: string;
  conversationId?: string;
  metadata?: DecisionTraceMetadata;
};

export type DecisionTraceEventV1 = DecisionTraceRecord & {
  schemaVersion: typeof DECISION_TRACE_SCHEMA_VERSION;
  sequence: number;
};

export type DecisionTraceSink = {
  record(record: DecisionTraceRecord): void | Promise<void>;
};

export type DeterministicDecisionTraceCompletion = {
  turnId: string;
  clinicId: string;
  conversationId: string;
  state: string;
  source: string;
  classifiedIntent: string | null;
  finalIntent: string | null;
  confidence?: number;
  missingStages: ReadonlyArray<
    "state.loaded" | "intent.classified" | "intent.resolved"
  >;
};

export const noopDecisionTraceSink: DecisionTraceSink = {
  record() {
    // Destino explícito para contextos que não devem capturar traces.
  },
};

export function hasResponseDecisionTraceMetadataContract(
  stage: DecisionTraceStage,
): boolean {
  return stage in RESPONSE_DECISION_TRACE_METADATA_KEYS;
}

export function sanitizeResponseDecisionTraceRecord(
  record: DecisionTraceRecord,
): DecisionTraceRecord {
  const allowedKeys = RESPONSE_DECISION_TRACE_METADATA_KEY_SETS[record.stage];
  if (!allowedKeys) return record;

  const metadata = Object.fromEntries(
    Object.entries(record.metadata ?? {}).filter(([key]) => allowedKeys.has(key)),
  ) as DecisionTraceMetadata;

  return {
    ...record,
    ...(Object.keys(metadata).length > 0 ? { metadata } : { metadata: undefined }),
  };
}

/**
 * Trace nunca pode interromper o atendimento. Em replay, o sink em memória
 * continua expondo todos os eventos capturados para que ausência de estágio
 * seja tratada como falha do teste.
 */
export async function recordDecisionTrace(
  sink: DecisionTraceSink | undefined,
  record: DecisionTraceRecord,
): Promise<void> {
  if (!DECISION_TRACE_STAGE_ALLOWLIST.has(record.stage)) return;

  try {
    await (sink ?? noopDecisionTraceSink).record(
      sanitizeResponseDecisionTraceRecord(record),
    );
  } catch {
    // Observabilidade é best-effort no runtime e não muda decisões de negócio.
  }
}

/**
 * Completa a trilha quando uma regra determinística encerra o turno antes do
 * classificador normal. O chamador declara somente os estágios que o seu ramo
 * pulou, evitando duplicar eventos já registrados.
 */
export async function recordDeterministicDecisionTraceCompletion(
  sink: DecisionTraceSink | undefined,
  input: DeterministicDecisionTraceCompletion,
): Promise<void> {
  const base = {
    turnId: input.turnId,
    occurredAt: new Date().toISOString(),
    clinicId: input.clinicId,
    conversationId: input.conversationId,
  };

  if (input.missingStages.includes("state.loaded")) {
    await recordDecisionTrace(sink, {
      ...base,
      stage: "state.loaded",
      metadata: {
        state: input.state,
        source: input.source,
        deterministic: true,
      },
    });
  }
  if (input.missingStages.includes("intent.classified")) {
    await recordDecisionTrace(sink, {
      ...base,
      stage: "intent.classified",
      metadata: {
        intent: input.classifiedIntent,
        confidence: input.confidence ?? 1,
        source: input.source,
        deterministic: true,
      },
    });
  }
  if (input.missingStages.includes("intent.resolved")) {
    await recordDecisionTrace(sink, {
      ...base,
      stage: "intent.resolved",
      metadata: {
        classifiedIntent: input.classifiedIntent,
        finalIntent: input.finalIntent,
        classifierOverridden: input.classifiedIntent !== input.finalIntent,
        source: input.source,
        deterministic: true,
      },
    });
  }
}

export class InMemoryDecisionTraceSink implements DecisionTraceSink {
  private readonly events: DecisionTraceEventV1[] = [];
  private readonly nextSequenceByTurn = new Map<string, number>();

  record(record: DecisionTraceRecord): void {
    const sequence = this.nextSequenceByTurn.get(record.turnId) ?? 0;
    this.nextSequenceByTurn.set(record.turnId, sequence + 1);
    this.events.push({
      schemaVersion: DECISION_TRACE_SCHEMA_VERSION,
      sequence,
      ...record,
      metadata: record.metadata ? { ...record.metadata } : undefined,
    });
  }

  getEvents(turnId?: string): DecisionTraceEventV1[] {
    return this.events
      .filter((event) => !turnId || event.turnId === turnId)
      .map((event) => ({
        ...event,
        metadata: event.metadata ? { ...event.metadata } : undefined,
      }));
  }

  clear(): void {
    this.events.length = 0;
    this.nextSequenceByTurn.clear();
  }
}
