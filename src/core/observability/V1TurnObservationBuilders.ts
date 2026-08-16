import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import { takeRecentConversationHistory } from "@/core/intelligence/ConversationHistoryWindow";
import type { Message } from "@/domain/entities/conversation";
import type { Treatment } from "@/domain/entities/treatment";
import {
  recordV1TurnObservation,
  type V1TurnObservationEvent,
  type V1TurnObservationSink,
} from "@/core/observability/V1TurnObservation";

type V1ObservationTreatment = Pick<
  Treatment,
  "id" | "name" | "priceCents" | "minPriceCents" | "priceQuotableInChat"
>;

export function buildV1HumanControlGateFact(
  turnId: string,
  effectiveHumanControlled: boolean,
): Extract<V1TurnObservationEvent, { kind: "turn_gate_fact" }> {
  return {
    kind: "turn_gate_fact",
    turnId,
    field: "humanControlled",
    value: effectiveHumanControlled,
    source: "v1_human_control",
  };
}

export function buildV1TurnContextObservation(input: {
  turnId: string;
  phase: string;
  pendingStepId: string | null;
  history: readonly Pick<Message, "author" | "body">[];
  historyWindowMessages?: number | null;
}): Extract<V1TurnObservationEvent, { kind: "turn_context" }> {
  const history = takeRecentConversationHistory(
    input.history,
    input.historyWindowMessages,
  );
  return {
    kind: "turn_context",
    turnId: input.turnId,
    phase: input.phase,
    pendingStepId: input.pendingStepId,
    completedStepIds: { status: "unavailable", reason: "not_read_by_v1" },
    history: history.map((message) => ({
      author: message.author === "lead" ? "lead" : "agent",
      body: message.body,
    })),
  };
}

export function buildV1TenantSnapshotObservation(input: {
  turnId: string;
  configFingerprint: string;
  treatments: readonly V1ObservationTreatment[];
}): Extract<V1TurnObservationEvent, { kind: "tenant_snapshot" }> {
  return {
    kind: "tenant_snapshot",
    turnId: input.turnId,
    configFingerprint: input.configFingerprint,
    policy: { status: "unavailable", reason: "not_read_by_v1" },
    catalog: input.treatments.map((treatment) => ({
      id: treatment.id,
      name: treatment.name,
      priceCents: treatment.priceCents,
      priceDisclosable:
        treatment.priceQuotableInChat && treatment.priceCents !== null,
    })),
  };
}

export function buildV1ServiceResolutionObservation(input: {
  turnId: string;
  query: string;
  resolution:
    | Readonly<{ kind: "exact"; treatment: V1ObservationTreatment }>
    | Readonly<{ kind: "ambiguous"; treatments: readonly Pick<Treatment, "id" | "name">[] }>
    | Readonly<{ kind: "unknown" }>;
}): Extract<V1TurnObservationEvent, { kind: "service_resolution" }> {
  const evidencePrefix = `v1-service:${input.turnId}`;
  if (input.resolution.kind === "exact") {
    const treatment = input.resolution.treatment;
    return {
      kind: "service_resolution",
      turnId: input.turnId,
      query: input.query,
      result: {
        kind: "exact",
        service: {
          id: treatment.id,
          name: treatment.name,
          priceCents: treatment.priceCents,
          priceDisclosable:
            treatment.priceQuotableInChat && treatment.priceCents !== null,
        },
        evidenceRef: `${evidencePrefix}:${treatment.id}`,
      },
    };
  }
  if (input.resolution.kind === "ambiguous") {
    return {
      kind: "service_resolution",
      turnId: input.turnId,
      query: input.query,
      result: {
        kind: "ambiguous",
        candidates: input.resolution.treatments.map((treatment) => ({
          id: treatment.id,
          name: treatment.name,
        })),
        evidenceRef: `${evidencePrefix}:ambiguous`,
      },
    };
  }
  return {
    kind: "service_resolution",
    turnId: input.turnId,
    query: input.query,
    result: { kind: "unknown", evidenceRef: `${evidencePrefix}:unknown` },
  };
}

export function buildV1SlotSearchObservation(input: {
  turnId: string;
  searchNow: Date;
  preferredDate: string | null;
  preferredPeriod: string | null;
  preferredTime: string | null;
  minimumLeadTimeHours: number;
  durationMinutes: number;
  windowStart: Date;
  windowEnd: Date;
  allowedStartWindows: readonly Readonly<{
    startHour: number;
    startMinute: number;
    weekdays?: readonly number[];
  }>[] | null;
  service: Readonly<{ id: string; name: string }>;
  slots: readonly Pick<FormattedSlot, "startsAt" | "label">[];
}): Extract<V1TurnObservationEvent, { kind: "slot_search" }> {
  const normalizedWindows = input.allowedStartWindows
    ? input.allowedStartWindows
        .map((window) => ({
          startHour: window.startHour,
          startMinute: window.startMinute,
          weekdays: window.weekdays
            ? [...window.weekdays].sort((left, right) => left - right)
            : null,
        }))
        .sort((left, right) =>
          left.startHour - right.startHour
          || left.startMinute - right.startMinute
          || JSON.stringify(left.weekdays).localeCompare(JSON.stringify(right.weekdays)))
    : null;
  return {
    kind: "slot_search",
    turnId: input.turnId,
    query: {
      service: input.service.name,
      date: input.preferredDate,
      period: input.preferredPeriod,
      preferredTime: input.preferredTime,
      minimumLeadTimeHours: input.minimumLeadTimeHours,
      now: input.searchNow.toISOString(),
      durationMinutes: input.durationMinutes,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
      allowedStartWindows: normalizedWindows,
    },
    service: input.service,
    slots: input.slots.map((slot) => ({
      id: slot.startsAt,
      label: slot.label,
      evidenceRef: `v1-slot:${input.turnId}:${slot.startsAt}`,
    })),
  };
}

export async function recordV1SlotSearchBeforeWrite<T>(input: {
  sink: V1TurnObservationSink | undefined;
  buildEvent: () => Extract<V1TurnObservationEvent, { kind: "slot_search" }>;
  write: () => Promise<T>;
}): Promise<T> {
  try {
    recordV1TurnObservation(input.sink, input.buildEvent());
  } catch {
    // Observation construction is best-effort and must never suppress the V1 write.
  }
  return input.write();
}
