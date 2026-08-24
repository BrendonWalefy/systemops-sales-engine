import { describe, expect, it, vi } from "vitest";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import { createDentalCatalogCapability, type DentalPolicy } from "@/domain-packs/dental/capabilities";
import type { DentalCatalogReadPort } from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const state = { phase: "active", pendingStepId: null, completedStepIds: [] };
const policy: DentalPolicy = {
  priceDisclosureEnabled: true, humanEscalationRequired: false,
  schedulingMinimumLeadTimeHours: 2, schedulingRequiresEvaluationFirst: false,
};
const understanding = (request: DentalRequest, service: string): Understanding<DentalRequest> => ({
  version: UNDERSTANDING_VERSION, request, dialogueMove: "new_topic",
  entities: { service }, signals: {}, safety: {}, confidence: 0.9, ambiguity: null,
});

describe("Dental Catalog capability", () => {
  it("amarra preço autorizado ao serviço resolvido e só lê durante decide", async () => {
    const resolveService = vi.fn<DentalCatalogReadPort["resolveService"]>().mockResolvedValue({
      kind: "exact", service: { id: "svc-1", name: "Clareamento", priceCents: 29_000, priceDisclosable: true, description: null },
      evidenceRef: "catalog-revision-7",
    });
    const capability = createDentalCatalogCapability({ resolveService });
    const claim = capability.claim(understanding("price-of-service", "clareamento"), state)!;
    expect(resolveService).not.toHaveBeenCalled();

    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    expect(resolveService).toHaveBeenCalledOnce();
    expect(decision).toEqual(expect.objectContaining({ kind: "answer", facts: [expect.objectContaining({
      key: "price_cents", value: { kind: "money", amountInMinor: 29_000, currency: "BRL" }, subject: { type: "service", id: "svc-1", displayName: "Clareamento" }, disclosure: "allowed",
    })] }));
    const result = await capability.execute(decision, { state, policy, now: new Date(0) });
    expect(result.type).toBe("catalog_answered");
    expect(resolveService).toHaveBeenCalledOnce();
  });

  it("pede clarificação para resolução unknown sem inventar fato", async () => {
    const capability = createDentalCatalogCapability({
      resolveService: async () => ({ kind: "unknown", evidenceRef: "catalog-1" }),
    });
    const claim = capability.claim(understanding("price-of-service", "lente"), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    expect(decision.kind).toBe("ask");
    expect((await capability.execute(decision, { state, policy, now: new Date(0) })).facts).toEqual([]);
  });

  it("oferece os candidatos reais na resolução ambiguous, em vez de clarificação vazia", async () => {
    const capability = createDentalCatalogCapability({
      resolveService: async () => ({
        kind: "ambiguous",
        candidates: [{ id: "a", name: "Lente A" }, { id: "b", name: "Lente B" }],
        evidenceRef: "catalog-1",
      }),
    });
    const claim = capability.claim(understanding("price-of-service", "lente"), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });

    expect(decision.kind).toBe("offer");
    const result = await capability.execute(decision, { state, policy, now: new Date(0) });
    expect(result.type).toBe("service_options_offered");
    expect(result.facts).toEqual([]);
  });

  it("não divulga preço quando policy proíbe", async () => {
    const capability = createDentalCatalogCapability({ resolveService: async () => ({
      kind: "exact", service: { id: "svc-1", name: "Clareamento", priceCents: 29_000, priceDisclosable: true, description: null }, evidenceRef: "catalog-1",
    }) });
    const claim = capability.claim(understanding("price-of-service", "clareamento"), state)!;
    const decision = await capability.decide(claim, { state, policy: { ...policy, priceDisclosureEnabled: false }, now: new Date(0) });
    expect(decision.kind).toBe("ask");
  });

  it("escala preço bloqueado somente quando policy exige humano", async () => {
    const capability = createDentalCatalogCapability({ resolveService: async () => ({
      kind: "exact", service: { id: "svc-1", name: "Clareamento", priceCents: 29_000, priceDisclosable: false, description: null }, evidenceRef: "catalog-1",
    }) });
    const claim = capability.claim(understanding("price-of-service", "clareamento"), state)!;
    const blockedPolicy = { ...policy, humanEscalationRequired: true };
    const decision = await capability.decide(claim, { state, policy: blockedPolicy, now: new Date(0) });
    expect(decision.kind).toBe("escalate");
    expect((await capability.execute(decision, { state, policy: blockedPolicy, now: new Date(0) })).type).toBe("escalation_required");
  });
});
