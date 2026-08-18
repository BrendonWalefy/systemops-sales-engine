import { describe, expect, it } from "vitest";
import { parseCapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";

function fixture(): Record<string, unknown> {
  return {
    version: "captured-v2-turn-reads.v1",
    now: "2026-08-16T12:00:00.000Z",
    gateInput: { status: "captured", value: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false } },
    state: { phase: "active", pendingStepId: null, completedStepIds: ["welcome"] },
    leadMessage: "Quero agendar",
    history: [{ author: "lead", body: "Olá" }],
    policy: { priceDisclosureEnabled: true, humanEscalationRequired: false, schedulingMinimumLeadTimeHours: 2, schedulingRequiresEvaluationFirst: false },
    catalog: { status: "captured", value: [{ id: "svc-1", name: "Limpeza", priceCents: 25000, priceDisclosable: true }] },
    serviceResolutions: [{ query: "limpeza", result: { kind: "exact", service: { id: "svc-1", name: "Limpeza", priceCents: 25000, priceDisclosable: true }, evidenceRef: "catalog-1" } }],
    slotSearches: [{ input: { service: null, date: "2026-08-17", period: "afternoon", minimumLeadTimeHours: 2, now: "2026-08-16T12:00:00.000Z" }, result: { service: { id: "svc-1", name: "Limpeza" }, slots: [{ id: "slot-1", label: "17/08 15:00", evidenceRef: "slots-1" }] } }],
    offeredSlotResolutions: [{ pendingStepId: "offer-1", ordinal: 1, date: null, time: null, result: { id: "slot-1", label: "17/08 15:00", evidenceRef: "slots-1" } }],
    pendingAppointmentResolutions: [{ pendingStepId: "confirm-1", result: { id: "appt-1", label: "17/08 15:00", evidenceRef: "appointment-1" } }],
  };
}

function allFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Reflect.ownKeys(value).every((key) => allFrozen(Reflect.get(value, key), seen));
}

describe("Captured V2 turn reads", () => {
  it("canonicaliza em uma árvore imutável sem aliases e isolada de mutação posterior", () => {
    const input = fixture();
    const shared = { id: "svc-1", name: "Limpeza", priceCents: 25000, priceDisclosable: true };
    ((input.catalog as { value: unknown[] }).value)[0] = shared;
    (((input.serviceResolutions as { result: { service: unknown } }[])[0]!).result.service) = shared;
    input.history = [{ author: "lead", body: "Olá" }];
    const snapshot = parseCapturedV2TurnReads(input);
    const before = JSON.stringify(snapshot);
    (input.history as { body: string }[])[0]!.body = "mudou";
    ((input.catalog as { value: { name: string }[] }).value)[0]!.name = "Mudou";
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(allFrozen(snapshot)).toBe(true);
    expect(snapshot.history).not.toBe(input.history);
    const resolution = snapshot.serviceResolutions[0]!.result;
    if (snapshot.catalog.status !== "captured" || resolution.kind !== "exact") throw new Error("expected exact captured service");
    expect(snapshot.catalog.value[0]).not.toBe(resolution.service);
  });

  it("rejeita dados adversariais antes de ler getters ou aceitar objetos não plain", () => {
    const withUnknown = fixture();
    withUnknown.extra = true;
    expect(() => parseCapturedV2TurnReads(withUnknown)).toThrow(/invalid captured/i);
    const withSymbolKey = fixture();
    Object.defineProperty(withSymbolKey, Symbol("unexpected"), { enumerable: true, value: "data" });
    expect(() => parseCapturedV2TurnReads(withSymbolKey)).toThrow(/invalid captured/i);
    const nestedSymbolKey = fixture();
    Object.defineProperty((nestedSymbolKey.history as object[])[0]!, Symbol("unexpected"), { enumerable: true, value: "data" });
    expect(() => parseCapturedV2TurnReads(nestedSymbolKey)).toThrow(/invalid captured/i);
    const arraySymbolKey = fixture();
    Object.defineProperty(arraySymbolKey.history as object, Symbol("unexpected"), { enumerable: true, value: "data" });
    expect(() => parseCapturedV2TurnReads(arraySymbolKey)).toThrow(/invalid captured/i);
    const arrayWithUnknown = fixture();
    (arrayWithUnknown.history as { author: string; body: string }[] & { unexpected?: boolean }).unexpected = true;
    expect(() => parseCapturedV2TurnReads(arrayWithUnknown)).toThrow(/invalid captured/i);

    let reads = 0;
    const accessor = fixture();
    Object.defineProperty(accessor, "now", { enumerable: true, get: () => { reads += 1; return "2026-08-16T12:00:00.000Z"; } });
    expect(() => parseCapturedV2TurnReads(accessor)).toThrow(/invalid captured/i);
    expect(reads).toBe(0);

    for (const invalid of [new Date(), new Map(), () => undefined, Symbol("x"), NaN, Infinity]) {
      const malformed = fixture();
      malformed.leadMessage = invalid;
      expect(() => parseCapturedV2TurnReads(malformed)).toThrow(/invalid captured/i);
    }
    const proxy = new Proxy(fixture(), { ownKeys: () => { throw new Error("no read"); } });
    expect(() => parseCapturedV2TurnReads(proxy)).toThrow(/invalid captured/i);
  });
});
