import { describe, expect, it, vi } from "vitest";
import { parseCapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import { recordDentalIntendedEffect } from "@/application/conversation-v2/dental-intended-effects";
import { V2ShadowRunner } from "@/application/conversation-v2/v2-shadow-runner";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import type { Capability } from "@/conversation-core/capability/contract";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import * as dentalPackModule from "@/domain-packs/dental";
import type { DentalClaimPayload, DentalPolicy, DentalRequest } from "@/domain-packs/dental";

const style = { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" } as const;
const policy = { priceDisclosureEnabled: true, humanEscalationRequired: false, schedulingMinimumLeadTimeHours: 2, schedulingRequiresEvaluationFirst: false };
function reads(overrides: Record<string, unknown> = {}) {
  return parseCapturedV2TurnReads({
    version: "captured-v2-turn-reads.v1", now: "2026-08-16T12:00:00.000Z",
    gateInput: { status: "captured", value: { automationEnabled: true, duplicate: false, humanControlled: false, optedOut: false } },
    state: { phase: "active", pendingStepId: "offer-1", completedStepIds: [] }, leadMessage: "", history: [], policy,
    catalog: { status: "captured", value: [] }, serviceResolutions: [], slotSearches: [],
    offeredSlotResolutions: [{ pendingStepId: "offer-1", ordinal: 1, date: null, time: null, result: { id: "slot-secret", label: "17/08 15:00", evidenceRef: "offer-1" } }],
    pendingAppointmentResolutions: [], ...overrides,
  });
}
function understanding(request: DentalRequest): Understanding<DentalRequest> {
  return { version: UNDERSTANDING_VERSION, request, dialogueMove: "answers_pending", entities: { ordinal: 1 }, signals: {}, safety: {}, confidence: 1, ambiguity: null };
}

describe("V2 shadow runner", () => {
  it("para antes de Understanding quando gateInput não foi capturado", async () => {
    const understand = vi.fn();
    const runner = new V2ShadowRunner({ understand, hmacKey: "test-key", style });
    await expect(runner.run(reads({ gateInput: { status: "unavailable", reason: "not_read_by_v1" } }))).resolves.toEqual({ status: "unsupported", reason: "shared_read_unavailable" });
    expect(understand).not.toHaveBeenCalled();
  });

  it("intercepta execute e registra somente efeito intencional HMAC", async () => {
    const runner = new V2ShadowRunner({ understand: async () => understanding("confirm-slot"), hmacKey: "test-key", style });
    const result = await runner.run(reads());
    expect(result.status).toBe("simulation_not_executed");
    if (result.status !== "simulation_not_executed") throw new Error("expected simulation");
    expect(result.intendedEffects).toEqual([expect.objectContaining({ action: "book_slot", capabilityId: "dental-scheduling" })]);
    expect(JSON.stringify(result.intendedEffects)).not.toContain("slot-secret");
    expect(result.intendedEffects[0]!.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("conclui decisões somente-leitura sem write", async () => {
    const runner = new V2ShadowRunner({ understand: async () => ({ ...understanding("book-appointment"), dialogueMove: "new_topic", entities: {} }), hmacKey: "test-key", style });
    const result = await runner.run(reads({ slotSearches: [{ input: { service: null, date: null, period: null, minimumLeadTimeHours: 2, now: "2026-08-16T12:00:00.000Z" }, result: { service: { id: "svc", name: "Limpeza" }, slots: [] } }] }));
    expect(result.status).toBe("evaluated");
  });

  it("marca action desconhecida como unsupported", () => {
    expect(recordDentalIntendedEffect({ capabilityId: "dental-scheduling", decision: { kind: "execute", action: { type: "unknown", parameters: {} }, nextBestStep: null }, hmacKey: "key" })).toBeNull();
  });

  it("registra confirmação de appointment como efeito HMAC fechado", () => {
    const effect = recordDentalIntendedEffect({
      capabilityId: "dental-scheduling",
      decision: { kind: "execute", action: { type: "confirm-appointment", parameters: { appointmentId: "appt-secret" } }, nextBestStep: null },
      hmacKey: "key",
    });
    expect(effect).toEqual(expect.objectContaining({ action: "confirm_appointment" }));
    expect(JSON.stringify(effect)).not.toContain("appt-secret");
  });

  it("mapeia read não capturado do runner para shared_read_unavailable", async () => {
    const runner = new V2ShadowRunner({ understand: async () => ({ ...understanding("price-of-service"), dialogueMove: "new_topic", entities: { service: "limpeza" } }), hmacKey: "test-key", style });
    await expect(runner.run(reads())).resolves.toEqual({ status: "unsupported", reason: "shared_read_unavailable" });
  });

  it("não executa capability nem composer quando encontra um execute desconhecido", async () => {
    const execute = vi.fn();
    const capability: Capability<DentalRequest, DentalPolicy, DentalClaimPayload, typeof dentalPackModule.DENTAL_OUTCOME_SCHEMA> = {
      id: "test-capability",
      claim: () => ({ capabilityId: "test-capability", confidence: 1, reason: "test", payload: { kind: "escalation", emergency: false, requestsHuman: false } }),
      decide: async () => ({ kind: "execute", action: { type: "foreign", parameters: {} }, nextBestStep: null }),
      execute,
    };
    const packSpy = vi.spyOn(dentalPackModule, "createDentalPack").mockReturnValue({
      id: "dental", outcomeSchema: dentalPackModule.DENTAL_OUTCOME_SCHEMA, capabilities: [capability], journeys: [],
    });
    const compose = vi.spyOn(DeterministicResponseComposer.prototype, "compose");
    const runner = new V2ShadowRunner({ understand: async () => understanding("confirm-slot"), hmacKey: "test-key", style });

    await expect(runner.run(reads())).resolves.toEqual({ status: "unsupported", reason: "unknown_effect" });
    expect(execute).not.toHaveBeenCalled();
    expect(compose).not.toHaveBeenCalled();
    packSpy.mockRestore();
    compose.mockRestore();
  });
});
