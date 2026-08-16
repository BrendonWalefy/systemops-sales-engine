import { isProxy } from "node:util/types";

export type V1ObservationRead<T> =
  | Readonly<{ status: "captured"; value: T }>
  | Readonly<{ status: "unavailable"; reason: "not_read_by_v1" }>;

export type V1TurnObservationEvent =
  | Readonly<{
      kind: "turn_input";
      turnId: string;
      now: string;
      leadMessage: string;
    }>
  | Readonly<{
      kind: "turn_gate_fact";
      turnId: string;
      field: "automationEnabled" | "duplicate" | "humanControlled" | "optedOut";
      value: boolean;
      source: "job_automation" | "v1_dedupe" | "v1_human_control" | "v1_opt_out";
    }>
  | Readonly<{
      kind: "turn_context";
      turnId: string;
      phase: string;
      pendingStepId: string | null;
      completedStepIds: V1ObservationRead<readonly string[]>;
      history: readonly Readonly<{ author: "lead" | "agent"; body: string }>[];
    }>
  | Readonly<{
      kind: "tenant_snapshot";
      turnId: string;
      configFingerprint: string;
      policy: V1ObservationRead<Readonly<{
        priceDisclosureEnabled: boolean;
        humanEscalationRequired: boolean;
        schedulingMinimumLeadTimeHours: number;
        schedulingRequiresEvaluationFirst: boolean;
      }>>;
      catalog: readonly Readonly<{
        id: string;
        name: string;
        priceCents: number | null;
        priceDisclosable: boolean;
      }>[];
    }>
  | Readonly<{
      kind: "pending_slot_offer";
      turnId: string;
      pendingStepId: string | null;
      slots: readonly Readonly<{ id: string; label: string; evidenceRef: string }>[];
    }>
  | Readonly<{
      kind: "service_resolution";
      turnId: string;
      query: string;
      result:
        | Readonly<{
            kind: "exact";
            service: Readonly<{
              id: string;
              name: string;
              priceCents: number | null;
              priceDisclosable: boolean;
            }>;
            evidenceRef: string;
          }>
        | Readonly<{
            kind: "ambiguous";
            candidates: readonly Readonly<{ id: string; name: string }>[];
            evidenceRef: string;
          }>
        | Readonly<{ kind: "unknown"; evidenceRef: string }>;
    }>
  | Readonly<{
      kind: "slot_search";
      turnId: string;
      query: Readonly<{
        service: string | null;
        date: string | null;
        period: string | null;
        preferredTime: string | null;
        minimumLeadTimeHours: number;
        now: string;
        durationMinutes: number;
        windowStart: string;
        windowEnd: string;
        allowedStartWindows: readonly Readonly<{
          startHour: number;
          startMinute: number;
          weekdays: readonly number[] | null;
        }>[] | null;
      }>;
      service: Readonly<{ id: string; name: string }>;
      slots: readonly Readonly<{ id: string; label: string; evidenceRef: string }>[];
    }>
  | Readonly<{
      kind: "v1_response_plan";
      turnId: string;
      actionType: string;
      outcomeSummary: string;
      responseDigest: string;
      responseCharacters: number;
      latencyMs: number;
      modelId: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    }>
  | Readonly<{
      kind: "turn_terminal";
      turnId: string;
      replied: boolean;
      reason: string | null;
    }>;

export type V1TurnObservationSink = {
  record(event: V1TurnObservationEvent): void;
};

const EVENT_KEYS = {
  turn_input: ["kind", "turnId", "now", "leadMessage"],
  turn_gate_fact: ["kind", "turnId", "field", "value", "source"],
  turn_context: ["kind", "turnId", "phase", "pendingStepId", "completedStepIds", "history"],
  tenant_snapshot: ["kind", "turnId", "configFingerprint", "policy", "catalog"],
  pending_slot_offer: ["kind", "turnId", "pendingStepId", "slots"],
  service_resolution: ["kind", "turnId", "query", "result"],
  slot_search: ["kind", "turnId", "query", "service", "slots"],
  v1_response_plan: ["kind", "turnId", "actionType", "outcomeSummary", "responseDigest", "responseCharacters", "latencyMs", "modelId", "inputTokens", "outputTokens"],
  turn_terminal: ["kind", "turnId", "replied", "reason"],
} as const;

const GATE_SOURCE = {
  automationEnabled: "job_automation",
  duplicate: "v1_dedupe",
  humanControlled: "v1_human_control",
  optedOut: "v1_opt_out",
} as const;

function invalid(): never {
  throw new Error("invalid V1 turn observation");
}

function plainRecord(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
    || isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const source = value as object;
  const ownKeys = Reflect.ownKeys(source);
  if (
    ownKeys.some((key) => typeof key !== "string")
    || (keys && (
      ownKeys.length !== keys.length
      || ownKeys.some((key) => !keys.includes(key as string))
    ))
  ) invalid();
  const snapshot: Record<string, unknown> = {};
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
    snapshot[key as string] = descriptor.value;
  }
  return snapshot;
}

function string(value: unknown): string {
  if (typeof value !== "string") invalid();
  return value;
}

function nonEmptyString(value: unknown): string {
  const result = string(value);
  if (!result) invalid();
  return result;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) invalid();
  return value;
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : number(value);
}

function array(value: unknown): unknown[] {
  if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value)) invalid();
  const keys = Reflect.ownKeys(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)) invalid();
  const length = lengthDescriptor.value;
  if (!Number.isSafeInteger(length) || length < 0) invalid();
  if (keys.length !== length + 1 || !keys.includes("length")) invalid();
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function observationRead<T>(value: unknown, parse: (captured: unknown) => T): V1ObservationRead<T> {
  const source = plainRecord(value);
  const status = string(source.status);
  if (status === "captured") {
    if (Reflect.ownKeys(source).length !== 2 || !("value" in source)) invalid();
    return { status, value: parse(source.value) };
  }
  if (
    status !== "unavailable"
    || source.reason !== "not_read_by_v1"
    || Reflect.ownKeys(source).length !== 2
  ) invalid();
  return { status, reason: "not_read_by_v1" };
}

function history(value: unknown): readonly Readonly<{ author: "lead" | "agent"; body: string }>[] {
  return array(value).map((entry) => {
    const item = plainRecord(entry, ["author", "body"]);
    const author = string(item.author);
    if (author !== "lead" && author !== "agent") invalid();
    return { author, body: string(item.body) };
  });
}

function slots(value: unknown): readonly Readonly<{ id: string; label: string; evidenceRef: string }>[] {
  return array(value).map((entry) => {
    const item = plainRecord(entry, ["id", "label", "evidenceRef"]);
    return {
      id: nonEmptyString(item.id),
      label: string(item.label),
      evidenceRef: nonEmptyString(item.evidenceRef),
    };
  });
}

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  Object.freeze(value);
}

export function snapshotV1TurnObservation(
  event: V1TurnObservationEvent,
): V1TurnObservationEvent {
  const uncheckedSource = plainRecord(event);
  const kind = string(uncheckedSource.kind) as keyof typeof EVENT_KEYS;
  const keys = EVENT_KEYS[kind];
  if (!keys) invalid();
  const source = plainRecord(uncheckedSource, keys);
  const turnId = nonEmptyString(source.turnId);
  let snapshot: V1TurnObservationEvent;

  switch (kind) {
    case "turn_input":
      snapshot = { kind, turnId, now: nonEmptyString(source.now), leadMessage: string(source.leadMessage) };
      break;
    case "turn_gate_fact": {
      const field = string(source.field) as keyof typeof GATE_SOURCE;
      if (!GATE_SOURCE[field] || source.source !== GATE_SOURCE[field]) invalid();
      snapshot = { kind, turnId, field, value: boolean(source.value), source: GATE_SOURCE[field] };
      break;
    }
    case "turn_context":
      snapshot = {
        kind,
        turnId,
        phase: string(source.phase),
        pendingStepId: nullableString(source.pendingStepId),
        completedStepIds: observationRead(
          source.completedStepIds,
          (value) => array(value).map(string),
        ),
        history: history(source.history),
      };
      break;
    case "tenant_snapshot": {
      snapshot = {
        kind,
        turnId,
        configFingerprint: nonEmptyString(source.configFingerprint),
        policy: observationRead(source.policy, (value) => {
          const policy = plainRecord(value, ["priceDisclosureEnabled", "humanEscalationRequired", "schedulingMinimumLeadTimeHours", "schedulingRequiresEvaluationFirst"]);
          return {
            priceDisclosureEnabled: boolean(policy.priceDisclosureEnabled),
            humanEscalationRequired: boolean(policy.humanEscalationRequired),
            schedulingMinimumLeadTimeHours: number(policy.schedulingMinimumLeadTimeHours),
            schedulingRequiresEvaluationFirst: boolean(policy.schedulingRequiresEvaluationFirst),
          };
        }),
        catalog: array(source.catalog).map((entry) => {
          const item = plainRecord(entry, ["id", "name", "priceCents", "priceDisclosable"]);
          return {
            id: nonEmptyString(item.id),
            name: nonEmptyString(item.name),
            priceCents: nullableNumber(item.priceCents),
            priceDisclosable: boolean(item.priceDisclosable),
          };
        }),
      };
      break;
    }
    case "pending_slot_offer":
      snapshot = { kind, turnId, pendingStepId: nullableString(source.pendingStepId), slots: slots(source.slots) };
      break;
    case "service_resolution": {
      const result = plainRecord(source.result);
      const resultKind = string(result.kind);
      if (resultKind === "exact") {
        const exact = plainRecord(result, ["kind", "service", "evidenceRef"]);
        const service = plainRecord(exact.service, ["id", "name", "priceCents", "priceDisclosable"]);
        snapshot = {
          kind,
          turnId,
          query: nonEmptyString(source.query),
          result: {
            kind: resultKind,
            service: {
              id: nonEmptyString(service.id),
              name: nonEmptyString(service.name),
              priceCents: nullableNumber(service.priceCents),
              priceDisclosable: boolean(service.priceDisclosable),
            },
            evidenceRef: nonEmptyString(exact.evidenceRef),
          },
        };
        break;
      }
      if (resultKind === "ambiguous") {
        const ambiguous = plainRecord(result, ["kind", "candidates", "evidenceRef"]);
        snapshot = {
          kind,
          turnId,
          query: nonEmptyString(source.query),
          result: {
            kind: resultKind,
            candidates: array(ambiguous.candidates).map((candidate) => {
              const item = plainRecord(candidate, ["id", "name"]);
              return { id: nonEmptyString(item.id), name: nonEmptyString(item.name) };
            }),
            evidenceRef: nonEmptyString(ambiguous.evidenceRef),
          },
        };
        break;
      }
      if (resultKind !== "unknown") invalid();
      const unknown = plainRecord(result, ["kind", "evidenceRef"]);
      snapshot = {
        kind,
        turnId,
        query: nonEmptyString(source.query),
        result: { kind: resultKind, evidenceRef: nonEmptyString(unknown.evidenceRef) },
      };
      break;
    }
    case "slot_search": {
      const query = plainRecord(source.query, ["service", "date", "period", "preferredTime", "minimumLeadTimeHours", "now", "durationMinutes", "windowStart", "windowEnd", "allowedStartWindows"]);
      const service = plainRecord(source.service, ["id", "name"]);
      snapshot = {
        kind,
        turnId,
        query: {
          service: nullableString(query.service),
          date: nullableString(query.date),
          period: nullableString(query.period),
          preferredTime: nullableString(query.preferredTime),
          minimumLeadTimeHours: number(query.minimumLeadTimeHours),
          now: nonEmptyString(query.now),
          durationMinutes: number(query.durationMinutes),
          windowStart: nonEmptyString(query.windowStart),
          windowEnd: nonEmptyString(query.windowEnd),
          allowedStartWindows: query.allowedStartWindows === null
            ? null
            : array(query.allowedStartWindows).map((window) => {
                const item = plainRecord(window, ["startHour", "startMinute", "weekdays"]);
                return {
                  startHour: number(item.startHour),
                  startMinute: number(item.startMinute),
                  weekdays: item.weekdays === null ? null : array(item.weekdays).map(number),
                };
              }),
        },
        service: { id: nonEmptyString(service.id), name: nonEmptyString(service.name) },
        slots: slots(source.slots),
      };
      break;
    }
    case "v1_response_plan":
      snapshot = {
        kind,
        turnId,
        actionType: nonEmptyString(source.actionType),
        outcomeSummary: nonEmptyString(source.outcomeSummary),
        responseDigest: nonEmptyString(source.responseDigest),
        responseCharacters: number(source.responseCharacters),
        latencyMs: number(source.latencyMs),
        modelId: nullableString(source.modelId),
        inputTokens: nullableNumber(source.inputTokens),
        outputTokens: nullableNumber(source.outputTokens),
      };
      break;
    case "turn_terminal":
      snapshot = { kind, turnId, replied: boolean(source.replied), reason: nullableString(source.reason) };
      break;
    default:
      return invalid();
  }

  deepFreeze(snapshot);
  return snapshot;
}

export function recordV1TurnObservation(
  sink: V1TurnObservationSink | undefined,
  event: V1TurnObservationEvent,
): void {
  if (!sink) return;
  try {
    sink.record(snapshotV1TurnObservation(event));
  } catch {
    // Observability is best-effort and cannot influence a V1 branch.
  }
}
