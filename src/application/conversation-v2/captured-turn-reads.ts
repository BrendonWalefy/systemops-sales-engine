import type { ConversationState } from "@/conversation-core/capability/contract";
import type { DentalPolicy } from "@/domain-packs/dental";
import type {
  DentalService,
  DentalSlot,
  DentalSlotSearchResult,
  PendingDentalAppointment,
  ServiceResolution,
} from "@/domain-packs/dental/ports";

export type CapturedRead<T> =
  | Readonly<{ status: "captured"; value: T }>
  | Readonly<{ status: "unavailable"; reason: "not_read_by_v1" | "unsupported_shape" }>;

export type CapturedV2TurnReads = Readonly<{
  version: "captured-v2-turn-reads.v1";
  now: string;
  gateInput: CapturedRead<Readonly<{ automationEnabled: boolean; duplicate: boolean; humanControlled: boolean; optedOut: boolean }>>;
  state: ConversationState;
  leadMessage: string;
  history: readonly Readonly<{ author: "lead" | "agent"; body: string }>[];
  policy: DentalPolicy;
  catalog: CapturedRead<readonly DentalService[]>;
  serviceResolutions: readonly Readonly<{ query: string; result: ServiceResolution }>[];
  slotSearches: readonly Readonly<{
    input: Readonly<{ service: string | null; date: string | null; period: string | null; minimumLeadTimeHours: number; now: string }>;
    result: DentalSlotSearchResult;
  }> [];
  offeredSlotResolutions: readonly Readonly<{ pendingStepId: string; ordinal: number | null; date: string | null; time: string | null; result: DentalSlot | null }> [];
  pendingAppointmentResolutions: readonly Readonly<{ pendingStepId: string; result: PendingDentalAppointment | null }> [];
}>;

const READ_REASONS = new Set(["not_read_by_v1", "unsupported_shape"]);

function invalid(): never {
  throw new Error("invalid captured turn reads");
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && ownKeys.every((key) => typeof key === "string" && keys.includes(key));
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const result = value as Record<string, unknown>;
  if (!hasExactKeys(result, keys)) invalid();
  return result;
}

function string(value: unknown): string {
  if (typeof value !== "string") invalid();
  return value;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid();
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function dataSnapshot(value: unknown): unknown {
  const assertDenseArrayKeys = (source: unknown[]): void => {
    const keys = Reflect.ownKeys(source);
    if (keys.length !== source.length + 1 || !keys.includes("length")) invalid();
    for (let index = 0; index < source.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(source, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
    }
  };
  function inspect(source: unknown, seen = new WeakSet<object>()): void {
    if (source === null || typeof source !== "object") return;
    if (seen.has(source)) return;
    seen.add(source);
    const array = Array.isArray(source);
    if (Object.getPrototypeOf(source) !== (array ? Array.prototype : Object.prototype)) invalid();
    if (array) assertDenseArrayKeys(source);
    for (const key of Reflect.ownKeys(source)) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
      inspect(descriptor.value, seen);
    }
  }
  try {
    inspect(value);
    const cloned = structuredClone(value);
    const copy = (source: unknown): unknown => {
      if (source === null || typeof source !== "object") {
        if (typeof source === "number" && !Number.isFinite(source)) invalid();
        if (typeof source === "string" || typeof source === "boolean" || typeof source === "number" || source === null) return source;
        invalid();
      }
      if (Array.isArray(source)) return source.map(copy);
      if (Object.getPrototypeOf(source) !== Object.prototype) invalid();
      const result: Record<string, unknown> = {};
      for (const key of Reflect.ownKeys(source)) {
        if (typeof key !== "string") invalid();
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid();
        result[key] = copy(descriptor.value);
      }
      return result;
    };
    return copy(cloned);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid captured turn reads") throw error;
    invalid();
  }
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

function dentalService(value: unknown): DentalService {
  const source = record(value, ["id", "name", "priceCents", "priceDisclosable"]);
  return { id: string(source.id), name: string(source.name), priceCents: source.priceCents === null ? null : finiteNumber(source.priceCents), priceDisclosable: boolean(source.priceDisclosable) };
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function dentalSlot(value: unknown): DentalSlot {
  const source = record(value, ["id", "label", "evidenceRef"]);
  return { id: string(source.id), label: string(source.label), evidenceRef: string(source.evidenceRef) };
}

function pendingAppointment(value: unknown): PendingDentalAppointment {
  const source = record(value, ["id", "label", "evidenceRef"]);
  return { id: string(source.id), label: string(source.label), evidenceRef: string(source.evidenceRef) };
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

function serviceResolution(value: unknown): ServiceResolution {
  const source = record(value, ["kind", ...(value && typeof value === "object" && !Array.isArray(value) && (value as { kind?: unknown }).kind === "exact" ? ["service", "evidenceRef"] : value && typeof value === "object" && !Array.isArray(value) && (value as { kind?: unknown }).kind === "ambiguous" ? ["candidates", "evidenceRef"] : ["evidenceRef"])]);
  const kind = string(source.kind);
  if (kind === "exact") return { kind, service: dentalService(source.service), evidenceRef: string(source.evidenceRef) };
  if (kind === "unknown") return { kind, evidenceRef: string(source.evidenceRef) };
  if (kind !== "ambiguous") invalid();
  return {
    kind,
    candidates: array(source.candidates).map((candidate) => {
      const item = record(candidate, ["id", "name"]);
      return { id: string(item.id), name: string(item.name) };
    }),
    evidenceRef: string(source.evidenceRef),
  };
}

function capturedRead<T>(value: unknown, parser: (captured: unknown) => T): CapturedRead<T> {
  const source = record(value, ["status", ...(value && typeof value === "object" && !Array.isArray(value) && (value as { status?: unknown }).status === "captured" ? ["value"] : ["reason"])]);
  const status = string(source.status);
  if (status === "captured") return { status, value: parser(source.value) };
  if (status !== "unavailable" || !READ_REASONS.has(string(source.reason))) invalid();
  return { status, reason: source.reason as "not_read_by_v1" | "unsupported_shape" };
}

export function parseCapturedV2TurnReads(input: unknown): CapturedV2TurnReads {
  try {
    const snapshot = dataSnapshot(input);
    const source = record(snapshot, ["version", "now", "gateInput", "state", "leadMessage", "history", "policy", "catalog", "serviceResolutions", "slotSearches", "offeredSlotResolutions", "pendingAppointmentResolutions"]);
    if (source.version !== "captured-v2-turn-reads.v1") invalid();
    const state = record(source.state, ["phase", "pendingStepId", "completedStepIds"]);
    const policy = record(source.policy, ["priceDisclosureEnabled", "humanEscalationRequired", "schedulingMinimumLeadTimeHours", "schedulingRequiresEvaluationFirst"]);
    const result = {
      version: source.version,
      now: string(source.now),
      gateInput: capturedRead(source.gateInput, (gate) => {
        const item = record(gate, ["automationEnabled", "duplicate", "humanControlled", "optedOut"]);
        return { automationEnabled: boolean(item.automationEnabled), duplicate: boolean(item.duplicate), humanControlled: boolean(item.humanControlled), optedOut: boolean(item.optedOut) };
      }),
      state: { phase: string(state.phase), pendingStepId: nullableString(state.pendingStepId), completedStepIds: array(state.completedStepIds).map(string) },
      leadMessage: string(source.leadMessage),
      history: array(source.history).map((entry) => {
        const item = record(entry, ["author", "body"]);
        const author = string(item.author);
        if (author !== "lead" && author !== "agent") invalid();
        return { author, body: string(item.body) };
      }),
      policy: { priceDisclosureEnabled: boolean(policy.priceDisclosureEnabled), humanEscalationRequired: boolean(policy.humanEscalationRequired), schedulingMinimumLeadTimeHours: finiteNumber(policy.schedulingMinimumLeadTimeHours), schedulingRequiresEvaluationFirst: boolean(policy.schedulingRequiresEvaluationFirst) },
      catalog: capturedRead(source.catalog, (catalog) => array(catalog).map(dentalService)),
      serviceResolutions: array(source.serviceResolutions).map((entry) => {
        const item = record(entry, ["query", "result"]);
        return { query: string(item.query), result: serviceResolution(item.result) };
      }),
      slotSearches: array(source.slotSearches).map((entry) => {
        const item = record(entry, ["input", "result"]);
        const slotInput = record(item.input, ["service", "date", "period", "minimumLeadTimeHours", "now"]);
        const slotResult = record(item.result, ["service", "slots"]);
        const service = record(slotResult.service, ["id", "name"]);
        return { input: { service: nullableString(slotInput.service), date: nullableString(slotInput.date), period: nullableString(slotInput.period), minimumLeadTimeHours: finiteNumber(slotInput.minimumLeadTimeHours), now: string(slotInput.now) }, result: { service: { id: string(service.id), name: string(service.name) }, slots: array(slotResult.slots).map(dentalSlot) } };
      }),
      offeredSlotResolutions: array(source.offeredSlotResolutions).map((entry) => {
        const item = record(entry, ["pendingStepId", "ordinal", "date", "time", "result"]);
        return { pendingStepId: string(item.pendingStepId), ordinal: item.ordinal === null ? null : finiteNumber(item.ordinal), date: nullableString(item.date), time: nullableString(item.time), result: item.result === null ? null : dentalSlot(item.result) };
      }),
      pendingAppointmentResolutions: array(source.pendingAppointmentResolutions).map((entry) => {
        const item = record(entry, ["pendingStepId", "result"]);
        return { pendingStepId: string(item.pendingStepId), result: item.result === null ? null : pendingAppointment(item.result) };
      }),
    };
    deepFreeze(result);
    return result as CapturedV2TurnReads;
  } catch {
    return invalid();
  }
}
