import { isProxy } from "node:util/types";
import {
  snapshotV1TurnObservation,
  type V1TurnObservationEvent,
  type V1TurnObservationSink,
} from "@/core/observability/V1TurnObservation";
import {
  parseCapturedV2TurnReads,
  type CapturedRead,
  type CapturedV2TurnReads,
} from "@/application/conversation-v2/captured-turn-reads";

type EventOf<Kind extends V1TurnObservationEvent["kind"]> = Extract<
  V1TurnObservationEvent,
  { kind: Kind }
>;

export type CapturedV1SharedReads = Readonly<{
  input: EventOf<"turn_input">;
  gateFacts: readonly EventOf<"turn_gate_fact">[];
  context: EventOf<"turn_context">;
  tenantSnapshot: EventOf<"tenant_snapshot">;
  pendingSlotOffers: readonly EventOf<"pending_slot_offer">[];
  serviceResolutions: readonly EventOf<"service_resolution">[];
  pendingAppointmentResolutions: readonly EventOf<"pending_appointment_resolution">[];
  slotSearches: readonly EventOf<"slot_search">[];
}>;

export type CapturedV1ControlArm = Readonly<{
  responsePlans: readonly EventOf<"v1_response_plan">[];
  terminal: EventOf<"turn_terminal">;
}>;

export type CapturedV1Turn = Readonly<{
  turnId: string;
  sharedReads: CapturedV1SharedReads;
  controlArm: CapturedV1ControlArm;
}>;

export type CapturedV1TurnSharedProjection = Readonly<{
  turnId: string;
  sharedReads: CapturedV1SharedReads;
  controlArm?: never;
}>;

export type CapturedV2TurnReadsPromotion =
  | Readonly<{ status: "ready"; reads: CapturedV2TurnReads }>
  | Readonly<{
      status: "shared_read_unavailable";
      unavailableReads: readonly Readonly<{
        field: "state.completedStepIds" | "policy";
        reason: "not_read_by_v1";
      }>[];
    }>;

type TurnAccumulator = {
  invalid: boolean;
  invalidGate: boolean;
  input?: EventOf<"turn_input">;
  gateFacts: EventOf<"turn_gate_fact">[];
  context?: EventOf<"turn_context">;
  tenantSnapshot?: EventOf<"tenant_snapshot">;
  pendingSlotOffers: EventOf<"pending_slot_offer">[];
  serviceResolutions: EventOf<"service_resolution">[];
  pendingAppointmentResolutions: EventOf<"pending_appointment_resolution">[];
  slotSearches: EventOf<"slot_search">[];
  responsePlans: EventOf<"v1_response_plan">[];
  terminal?: EventOf<"turn_terminal">;
};

const registeredSharedSnapshots = new WeakMap<object, string>();
const registeredCapturedTurns = new WeakSet<object>();
const INVALID_SHARED_PROJECTION = "invalid captured V1 shared projection";

function deepFreeze(value: unknown, seen = new WeakSet<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  Object.freeze(value);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setSingleton<Key extends "input" | "context" | "tenantSnapshot" | "terminal">(
  accumulator: TurnAccumulator,
  key: Key,
  event: NonNullable<TurnAccumulator[Key]>,
): void {
  const current = accumulator[key];
  if (current && !same(current, event)) accumulator.invalid = true;
  else (accumulator[key] as NonNullable<TurnAccumulator[Key]>) = event;
}

const EXPECTED_GATE_SOURCE = {
  automationEnabled: "job_automation",
  duplicate: "v1_dedupe",
  humanControlled: "v1_human_control",
  optedOut: "v1_opt_out",
} as const;

export class V1ObservationCollector implements V1TurnObservationSink {
  private readonly turns = new Map<string, TurnAccumulator>();
  private completed: CapturedV1Turn[] = [];

  record(input: V1TurnObservationEvent): void {
    let event: V1TurnObservationEvent;
    try {
      event = snapshotV1TurnObservation(input);
    } catch {
      return;
    }
    const accumulator = this.turns.get(event.turnId) ?? {
      invalid: false,
      invalidGate: false,
      gateFacts: [],
      pendingSlotOffers: [],
      serviceResolutions: [],
      pendingAppointmentResolutions: [],
      slotSearches: [],
      responsePlans: [],
    };
    this.turns.set(event.turnId, accumulator);

    switch (event.kind) {
      case "turn_input": setSingleton(accumulator, "input", event); break;
      case "turn_context": setSingleton(accumulator, "context", event); break;
      case "tenant_snapshot": setSingleton(accumulator, "tenantSnapshot", event); break;
      case "turn_terminal": setSingleton(accumulator, "terminal", event); break;
      case "pending_slot_offer": accumulator.pendingSlotOffers.push(event); break;
      case "service_resolution": accumulator.serviceResolutions.push(event); break;
      case "pending_appointment_resolution": accumulator.pendingAppointmentResolutions.push(event); break;
      case "slot_search": accumulator.slotSearches.push(event); break;
      case "v1_response_plan": accumulator.responsePlans.push(event); break;
      case "turn_gate_fact": {
        const existing = accumulator.gateFacts.find((fact) => fact.field === event.field);
        if (event.source !== EXPECTED_GATE_SOURCE[event.field] || (existing && !same(existing, event))) {
          accumulator.invalidGate = true;
        } else if (!existing) {
          accumulator.gateFacts.push(event);
        }
        break;
      }
    }
  }

  complete(turnId: string): CapturedV1Turn | null {
    const accumulator = this.turns.get(turnId);
    if (!accumulator?.terminal) return null;
    this.turns.delete(turnId);
    if (
      accumulator.invalid
      || accumulator.invalidGate
      || !accumulator.input
      || !accumulator.context
      || !accumulator.tenantSnapshot
    ) return null;

    const captured: CapturedV1Turn = {
      turnId,
      sharedReads: {
        input: accumulator.input,
        gateFacts: [...accumulator.gateFacts],
        context: {
          ...accumulator.context,
          completedStepIds: accumulator.context.completedStepIds,
        },
        tenantSnapshot: {
          ...accumulator.tenantSnapshot,
          policy: accumulator.tenantSnapshot.policy,
        },
        pendingSlotOffers: [...accumulator.pendingSlotOffers],
        serviceResolutions: [...accumulator.serviceResolutions],
        pendingAppointmentResolutions: [...accumulator.pendingAppointmentResolutions],
        slotSearches: [...accumulator.slotSearches],
      },
      controlArm: {
        responsePlans: [...accumulator.responsePlans],
        terminal: accumulator.terminal,
      },
    };
    deepFreeze(captured);
    registeredSharedSnapshots.set(captured.sharedReads, captured.turnId);
    registeredCapturedTurns.add(captured);
    this.completed.push(captured);
    return captured;
  }

  drain(): readonly CapturedV1Turn[] {
    const drained = Object.freeze([...this.completed]);
    this.completed = [];
    return drained;
  }
}

export function isRegisteredCapturedV1Turn(turn: CapturedV1Turn): boolean {
  return typeof turn === "object" && turn !== null && registeredCapturedTurns.has(turn);
}

function readRegisteredSharedProjection(
  input: CapturedV1TurnSharedProjection,
): CapturedV1SharedReads {
  if (
    typeof input !== "object"
    || input === null
    || isProxy(input)
    || Array.isArray(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error(INVALID_SHARED_PROJECTION);
  }

  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== 2
    || !keys.includes("turnId")
    || !keys.includes("sharedReads")
  ) {
    throw new Error(INVALID_SHARED_PROJECTION);
  }

  const turnIdDescriptor = Object.getOwnPropertyDescriptor(input, "turnId");
  const sharedReadsDescriptor = Object.getOwnPropertyDescriptor(input, "sharedReads");
  if (
    !turnIdDescriptor
    || !("value" in turnIdDescriptor)
    || !turnIdDescriptor.enumerable
    || !sharedReadsDescriptor
    || !("value" in sharedReadsDescriptor)
    || !sharedReadsDescriptor.enumerable
  ) {
    throw new Error(INVALID_SHARED_PROJECTION);
  }

  const turnId = turnIdDescriptor.value;
  const sharedReads = sharedReadsDescriptor.value;
  if (
    typeof turnId !== "string"
    || turnId.length === 0
    || typeof sharedReads !== "object"
    || sharedReads === null
    || registeredSharedSnapshots.get(sharedReads) !== turnId
  ) {
    throw new Error(INVALID_SHARED_PROJECTION);
  }

  return sharedReads as CapturedV1SharedReads;
}

function gateInput(
  sharedReads: CapturedV1SharedReads,
): CapturedRead<Readonly<{
  automationEnabled: boolean;
  duplicate: boolean;
  humanControlled: boolean;
  optedOut: boolean;
}>> {
  const values = new Map(sharedReads.gateFacts.map((fact) => [fact.field, fact]));
  const entries = Object.entries(EXPECTED_GATE_SOURCE) as Array<
    [keyof typeof EXPECTED_GATE_SOURCE, (typeof EXPECTED_GATE_SOURCE)[keyof typeof EXPECTED_GATE_SOURCE]]
  >;
  if (entries.some(([field, source]) => values.get(field)?.source !== source)) {
    return { status: "unavailable", reason: "not_read_by_v1" };
  }
  return {
    status: "captured",
    value: {
      automationEnabled: values.get("automationEnabled")!.value,
      duplicate: values.get("duplicate")!.value,
      humanControlled: values.get("humanControlled")!.value,
      optedOut: values.get("optedOut")!.value,
    },
  };
}

export function buildCapturedV2TurnReads(
  turn: CapturedV1TurnSharedProjection,
): CapturedV2TurnReadsPromotion {
  const reads = readRegisteredSharedProjection(turn);
  const completedStepIds = reads.context.completedStepIds;
  const policy = reads.tenantSnapshot.policy;
  if (completedStepIds.status === "unavailable" || policy.status === "unavailable") {
    const unavailableReads: Array<{
      field: "state.completedStepIds" | "policy";
      reason: "not_read_by_v1";
    }> = [];
    if (completedStepIds.status === "unavailable") {
      unavailableReads.push({
        field: "state.completedStepIds",
        reason: "not_read_by_v1",
      });
    }
    if (policy.status === "unavailable") {
      unavailableReads.push({
        field: "policy",
        reason: "not_read_by_v1",
      });
    }
    const unavailable: CapturedV2TurnReadsPromotion = {
      status: "shared_read_unavailable",
      unavailableReads,
    };
    deepFreeze(unavailable);
    return unavailable;
  }

  const pendingOffers = reads.pendingSlotOffers.filter((offer) => offer.pendingStepId !== null);
  const resolutionGroups = new Map<string, EventOf<"service_resolution">[]>();
  for (const resolution of reads.serviceResolutions) {
    const group = resolutionGroups.get(resolution.query) ?? [];
    group.push(resolution);
    resolutionGroups.set(resolution.query, group);
  }
  const serviceResolutions = [...resolutionGroups.values()].flatMap((group) => {
    const [first] = group;
    if (!first || group.some((entry) => !same(entry, first))) return [];
    return [{ query: first.query, result: first.result }];
  });

  const pendingAppointmentGroups = new Map<string, EventOf<"pending_appointment_resolution">[]>();
  for (const resolution of reads.pendingAppointmentResolutions) {
    if (resolution.pendingStepId !== reads.context.pendingStepId) continue;
    const group = pendingAppointmentGroups.get(resolution.pendingStepId) ?? [];
    group.push(resolution);
    pendingAppointmentGroups.set(resolution.pendingStepId, group);
  }
  const pendingAppointmentResolutions = [...pendingAppointmentGroups.values()].flatMap((group) => {
    const [first] = group;
    if (
      !first
      || first.result.kind === "query_mismatch"
      || group.some((entry) => !same(entry, first))
    ) return [];
    return [{
      pendingStepId: first.pendingStepId,
      result: first.result.kind === "exact" ? first.result.appointment : null,
    }];
  });
  // An unobserved or mismatched pending appointment stays absent so the captured
  // booking adapter reports shared_read_unavailable instead of guessing.

  const promoted = parseCapturedV2TurnReads({
    version: "captured-v2-turn-reads.v1",
    now: reads.input.now,
    gateInput: gateInput(reads),
    state: {
      phase: reads.context.phase,
      pendingStepId: reads.context.pendingStepId,
      completedStepIds: completedStepIds.value,
    },
    leadMessage: reads.input.leadMessage,
    history: reads.context.history,
    policy: policy.value,
    catalog: { status: "captured", value: reads.tenantSnapshot.catalog },
    serviceResolutions,
    // The V2 query cannot express the V1 duration, preferred time, search window,
    // or treatment booking windows. Replaying by its shorter key would fabricate
    // equivalence, so the complete V1 observations remain unavailable to V2.
    slotSearches: [],
    offeredSlotResolutions: pendingOffers.flatMap((offer) => offer.slots.map((slot, index) => ({
      pendingStepId: offer.pendingStepId!,
      ordinal: index + 1,
      date: null,
      time: null,
      result: slot,
    }))),
    pendingAppointmentResolutions,
  });
  return Object.freeze({ status: "ready", reads: promoted });
}
