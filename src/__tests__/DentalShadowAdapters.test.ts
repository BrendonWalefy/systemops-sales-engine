import { describe, expect, it } from "vitest";
import { createDentalCapturedReadAdapters } from "@/application/conversation-v2/dental-captured-read-adapters";
import { parseCapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";

function reads() {
  return parseCapturedV2TurnReads({
    version: "captured-v2-turn-reads.v1", now: "2026-08-16T12:00:00.000Z",
    gateInput: { status: "captured", value: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false } },
    state: { phase: "active", pendingStepId: "offer-1", completedStepIds: [] }, leadMessage: "", history: [],
    policy: { priceDisclosureEnabled: true, humanEscalationRequired: false, schedulingMinimumLeadTimeHours: 2, schedulingRequiresEvaluationFirst: false },
    catalog: { status: "captured", value: [] },
    serviceResolutions: [{ query: "limpeza", result: { kind: "unknown", evidenceRef: "catalog-1" } }],
    slotSearches: [{ input: { service: null, date: null, period: null, minimumLeadTimeHours: 2, now: "2026-08-16T12:00:00.000Z" }, result: { service: { id: "svc", name: "Limpeza" }, slots: [] } }],
    offeredSlotResolutions: [{ pendingStepId: "offer-1", ordinal: null, date: null, time: null, result: null }],
    pendingAppointmentResolutions: [{ pendingStepId: "offer-1", result: null }],
  });
}

describe("dental captured read adapters", () => {
  it("responde apenas consultas exatamente capturadas", async () => {
    const adapters = createDentalCapturedReadAdapters(reads());
    await expect(adapters.catalogRead.resolveService("limpeza")).resolves.toEqual({ kind: "unknown", evidenceRef: "catalog-1" });
    await expect(adapters.schedulingRead.listSlots({ service: null, date: null, period: null, minimumLeadTimeHours: 2, now: new Date("2026-08-16T12:00:00.000Z") })).resolves.toEqual({ service: { id: "svc", name: "Limpeza" }, slots: [] });
    await expect(adapters.catalogRead.resolveService("clareamento")).rejects.toThrow(/captured read unavailable/i);
    await expect(adapters.schedulingRead.resolveOfferedSlot({ pendingStepId: "different", ordinal: null, date: null, time: null })).rejects.toThrow(/captured read unavailable/i);
  });
});

