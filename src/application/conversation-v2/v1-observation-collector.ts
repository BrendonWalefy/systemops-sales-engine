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

type CapturedObservationRead<T> = Readonly<{ status: "captured"; value: T }>;
type CapturedTurnContext = Omit<EventOf<"turn_context">, "completedStepIds"> & Readonly<{
  completedStepIds: CapturedObservationRead<readonly string[]>;
}>;
type CapturedTenantSnapshot = Omit<EventOf<"tenant_snapshot">, "policy"> & Readonly<{
  policy: Extract<EventOf<"tenant_snapshot">["policy"], { status: "captured" }>;
}>;

export type CapturedV1SharedReads = Readonly<{
  input: EventOf<"turn_input">;
  gateFacts: readonly EventOf<"turn_gate_fact">[];
  context: CapturedTurnContext;
  tenantSnapshot: CapturedTenantSnapshot;
  pendingSlotOffers: readonly EventOf<"pending_slot_offer">[];
  serviceResolutions: readonly EventOf<"service_resolution">[];
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
  slotSearches: EventOf<"slot_search">[];
  responsePlans: EventOf<"v1_response_plan">[];
  terminal?: EventOf<"turn_terminal">;
};

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
      || accumulator.context.completedStepIds.status !== "captured"
      || accumulator.tenantSnapshot.policy.status !== "captured"
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
        slotSearches: [...accumulator.slotSearches],
      },
      controlArm: {
        responsePlans: [...accumulator.responsePlans],
        terminal: accumulator.terminal,
      },
    };
    deepFreeze(captured);
    this.completed.push(captured);
    return captured;
  }

  drain(): readonly CapturedV1Turn[] {
    const drained = Object.freeze([...this.completed]);
    this.completed = [];
    return drained;
  }
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
): CapturedV2TurnReads {
  const reads = turn.sharedReads;
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

  return parseCapturedV2TurnReads({
    version: "captured-v2-turn-reads.v1",
    now: reads.input.now,
    gateInput: gateInput(reads),
    state: {
      phase: reads.context.phase,
      pendingStepId: reads.context.pendingStepId,
      completedStepIds: reads.context.completedStepIds.value,
    },
    leadMessage: reads.input.leadMessage,
    history: reads.context.history,
    policy: reads.tenantSnapshot.policy.value,
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
    pendingAppointmentResolutions: [],
  });
}
