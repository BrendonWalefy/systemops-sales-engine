import { describe, expect, it, vi } from "vitest";
import { parseCapturedV2TurnReads } from "@/application/conversation-v2/captured-turn-reads";
import {
  buildCapturedV2TurnReads,
  V1ObservationCollector,
} from "@/application/conversation-v2/v1-observation-collector";
import { V2ShadowRunner } from "@/application/conversation-v2/v2-shadow-runner";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { runV2ResponsePipeline } from "@/conversation-core/composer/response-pipeline";
import { validateDraft } from "@/conversation-core/composer/validator";
import type { ActionResult } from "@/conversation-core/decision";
import { runTurnPipeline } from "@/conversation-core/turn-pipeline";
import {
  UNDERSTANDING_VERSION,
  type Understanding,
} from "@/conversation-core/understanding/schema";
import {
  createDentalEscalationCapability,
  createDentalSchedulingCapability,
  DENTAL_OUTCOME_SCHEMA,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import { createDentalPack } from "@/domain-packs/dental";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const style = {
  tone: "neutral",
  verbosity: "concise",
  greeting: "omit",
  emoji: "none",
} as const;

const policy: DentalPolicy = {
  priceDisclosureEnabled: true,
  humanEscalationRequired: false,
  schedulingMinimumLeadTimeHours: 2,
  schedulingRequiresEvaluationFirst: false,
};

const gateInput = {
  automationEnabled: true,
  duplicate: false,
  humanControlled: false,
  optedOut: false,
};

const journeyModeMatrix = [
  { journey: "price", mode: "happy", disposition: "supported", evidence: "price-runtime" },
  { journey: "price", mode: "boundary", disposition: "supported", evidence: "missing-capture-runtime" },
  { journey: "price", mode: "failure", disposition: "not_applicable", reason: "price has no write effect" },
  { journey: "price", mode: "adversarial", disposition: "not_applicable", reason: "cross-subject behavior belongs to multi-intent" },
  { journey: "price", mode: "recovery", disposition: "not_applicable", reason: "recovery behavior belongs to escalation" },
  { journey: "availability", mode: "happy", disposition: "unsupported/deferred", evidence: "v1-promotion-runtime", reason: "V1 slot-search key is not losslessly representable by V2" },
  { journey: "availability", mode: "boundary", disposition: "not_applicable", reason: "productive happy path already fails closed at shared-read boundary" },
  { journey: "availability", mode: "failure", disposition: "not_applicable", reason: "no availability write is admitted in shadow" },
  { journey: "availability", mode: "adversarial", disposition: "not_applicable", reason: "cross-subject behavior belongs to multi-intent" },
  { journey: "availability", mode: "recovery", disposition: "not_applicable", reason: "no availability recovery capability is in scope" },
  { journey: "booking_intent", mode: "happy", disposition: "not_applicable", reason: "shadow cannot execute a booking" },
  { journey: "booking_intent", mode: "boundary", disposition: "supported", evidence: "write-interception-runtime" },
  { journey: "booking_intent", mode: "failure", disposition: "not_applicable", reason: "write failure is an offline capability contract" },
  { journey: "booking_intent", mode: "adversarial", disposition: "not_applicable", reason: "cross-subject behavior belongs to multi-intent" },
  { journey: "booking_intent", mode: "recovery", disposition: "not_applicable", reason: "no booking recovery executes in shadow" },
  { journey: "write_failure", mode: "happy", disposition: "not_applicable", reason: "success writes are prohibited in shadow" },
  { journey: "write_failure", mode: "boundary", disposition: "not_applicable", reason: "write boundary is covered by booking intent" },
  { journey: "write_failure", mode: "failure", disposition: "supported_offline", evidence: "capability-runtime" },
  { journey: "write_failure", mode: "adversarial", disposition: "not_applicable", reason: "no cross-subject write is admitted" },
  { journey: "write_failure", mode: "recovery", disposition: "not_applicable", reason: "failure remains failure; no recovery claim is authorized" },
  { journey: "escalation", mode: "happy", disposition: "not_applicable", reason: "escalation is a recovery outcome" },
  { journey: "escalation", mode: "boundary", disposition: "not_applicable", reason: "handoff completion is outside the core contract" },
  { journey: "escalation", mode: "failure", disposition: "not_applicable", reason: "no handoff write exists in the Domain Pack" },
  { journey: "escalation", mode: "adversarial", disposition: "not_applicable", reason: "cross-subject behavior belongs to multi-intent" },
  { journey: "escalation", mode: "recovery", disposition: "supported", evidence: "escalation-runtime" },
  { journey: "multi_intent", mode: "happy", disposition: "not_applicable", reason: "single-subject happy paths are covered separately" },
  { journey: "multi_intent", mode: "boundary", disposition: "not_applicable", reason: "capture boundary is covered by price" },
  { journey: "multi_intent", mode: "failure", disposition: "not_applicable", reason: "multi-intent test contains no write" },
  { journey: "multi_intent", mode: "adversarial", disposition: "supported", evidence: "composer-runtime" },
  { journey: "multi_intent", mode: "recovery", disposition: "not_applicable", reason: "no multi-intent recovery policy is defined" },
] as const;

const deferredRequests = ["media", "objection", "discount", "follow_up"] as const;

function understanding(
  request: DentalRequest,
  input: Partial<Understanding<DentalRequest>> = {},
): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request,
    dialogueMove: "new_topic",
    entities: {},
    signals: {},
    safety: {},
    confidence: 1,
    ambiguity: null,
    ...input,
  };
}

function capturedReads(overrides: Record<string, unknown> = {}) {
  return parseCapturedV2TurnReads({
    version: "captured-v2-turn-reads.v1",
    now: "2026-08-16T12:00:00.000Z",
    gateInput: { status: "captured", value: gateInput },
    state: { phase: "active", pendingStepId: null, completedStepIds: [] },
    leadMessage: "mensagem sanitizada",
    history: [],
    policy,
    catalog: { status: "captured", value: [] },
    serviceResolutions: [],
    slotSearches: [],
    offeredSlotResolutions: [],
    pendingAppointmentResolutions: [],
    ...overrides,
  });
}

function promotedAvailabilityReads() {
  const turnId = "availability-real-v1-turn";
  const collector = new V1ObservationCollector();
  collector.record({
    kind: "turn_input",
    turnId,
    now: "2026-08-16T12:00:00.000Z",
    leadMessage: "Quero horários amanhã para limpeza",
  });
  for (const fact of [
    ["automationEnabled", true, "job_automation"],
    ["duplicate", false, "v1_dedupe"],
    ["humanControlled", false, "v1_human_control"],
    ["optedOut", false, "v1_opt_out"],
  ] as const) {
    collector.record({
      kind: "turn_gate_fact",
      turnId,
      field: fact[0],
      value: fact[1],
      source: fact[2],
    });
  }
  collector.record({
    kind: "turn_context",
    turnId,
    phase: "active",
    pendingStepId: null,
    completedStepIds: { status: "captured", value: [] },
    history: [],
  });
  collector.record({
    kind: "tenant_snapshot",
    turnId,
    configFingerprint: "availability-config",
    policy: { status: "captured", value: policy },
    catalog: [{ id: "service-private", name: "Limpeza", priceCents: null, priceDisclosable: false }],
  });
  collector.record({
    kind: "slot_search",
    turnId,
    query: {
      service: "limpeza",
      date: "amanhã",
      period: null,
      preferredTime: null,
      minimumLeadTimeHours: 2,
      now: "2026-08-16T12:00:00.000Z",
      durationMinutes: 30,
      windowStart: "2026-08-16T14:00:00.000Z",
      windowEnd: "2026-08-30T14:00:00.000Z",
      allowedStartWindows: null,
    },
    service: { id: "service-private", name: "Limpeza" },
    slots: [{ id: "slot-private", label: "amanhã às 15h", evidenceRef: "calendar-snapshot" }],
  });
  collector.record({ kind: "turn_terminal", turnId, replied: true, reason: null });
  const turn = collector.complete(turnId);
  if (!turn) throw new Error("expected captured V1 availability turn");
  return buildCapturedV2TurnReads({ turnId, sharedReads: turn.sharedReads });
}

describe("Cycle I supported journey matrix", () => {
  it("declara explicitamente cada célula journey×mode como exercida ou não aplicável com motivo", () => {
    const expectedCells = [
      "price/happy", "price/boundary", "price/failure", "price/adversarial", "price/recovery",
      "availability/happy", "availability/boundary", "availability/failure", "availability/adversarial", "availability/recovery",
      "booking_intent/happy", "booking_intent/boundary", "booking_intent/failure", "booking_intent/adversarial", "booking_intent/recovery",
      "write_failure/happy", "write_failure/boundary", "write_failure/failure", "write_failure/adversarial", "write_failure/recovery",
      "escalation/happy", "escalation/boundary", "escalation/failure", "escalation/adversarial", "escalation/recovery",
      "multi_intent/happy", "multi_intent/boundary", "multi_intent/failure", "multi_intent/adversarial", "multi_intent/recovery",
    ];
    expect(journeyModeMatrix.map(({ journey, mode }) => `${journey}/${mode}`)).toEqual(expectedCells);
    expect(journeyModeMatrix.filter((cell) => cell.disposition === "not_applicable")
      .every((cell) => "reason" in cell && cell.reason.length > 0)).toBe(true);
    expect(journeyModeMatrix.filter((cell) => cell.disposition !== "not_applicable")
      .every((cell) => "evidence" in cell && cell.evidence.endsWith("runtime"))).toBe(true);
  });

  it("price/happy verbaliza somente preço e subject capturados", async () => {
    const runner = new V2ShadowRunner({
      understand: async () => understanding("price-of-service", {
        entities: { service: "limpeza" },
      }),
      hmacKey: "matrix-key",
      style,
    });
    const result = await runner.run(capturedReads({
      catalog: {
        status: "captured",
        value: [{ id: "service-private", name: "Limpeza", priceCents: 29000, priceDisclosable: true }],
      },
      serviceResolutions: [{
        query: "limpeza",
        result: {
          kind: "exact",
          service: { id: "service-private", name: "Limpeza", priceCents: 29000, priceDisclosable: true },
          evidenceRef: "catalog-snapshot",
        },
      }],
    }));

    expect(result.status).toBe("evaluated");
    if (result.status !== "evaluated") throw new Error("price journey was not evaluated");
    expect(result.actionResults.map(({ type }) => type)).toEqual(["catalog_answered"]);
    expect(result.actionResults[0]?.subject).toEqual({
      type: "service",
      id: "service-private",
      displayName: "Limpeza",
    });
    expect(result.response.text).toContain("R$ 290,00");
    expect(result.response.text).not.toContain("service-private");
  });

  it("availability/happy produtivo fica unsupported/deferred quando o slot search V1 não é lossless", async () => {
    const promotion = promotedAvailabilityReads();
    expect(promotion.status).toBe("ready");
    if (promotion.status !== "ready") throw new Error("expected ready shared-read promotion");
    expect(promotion.reads.slotSearches).toEqual([]);
    const runner = new V2ShadowRunner({
      understand: async () => understanding("book-appointment", {
        entities: { service: "limpeza", date: "amanhã" },
      }),
      hmacKey: "matrix-key",
      style,
    });
    await expect(runner.run(promotion.reads)).resolves.toEqual({
      status: "unsupported",
      reason: "shared_read_unavailable",
    });
  });

  it("booking_intent/boundary para antes do write e registra só intenção HMAC", async () => {
    const runner = new V2ShadowRunner({
      understand: async () => understanding("confirm-slot", {
        dialogueMove: "answers_pending",
        entities: { ordinal: 1 },
      }),
      hmacKey: "matrix-key",
      style,
    });
    const result = await runner.run(capturedReads({
      state: { phase: "awaiting_slot", pendingStepId: "offer-private", completedStepIds: [] },
      offeredSlotResolutions: [{
        pendingStepId: "offer-private",
        ordinal: 1,
        date: null,
        time: null,
        result: { id: "slot-private", label: "amanhã às 15h", evidenceRef: "offer-snapshot" },
      }],
    }));

    expect(result.status).toBe("simulation_not_executed");
    if (result.status !== "simulation_not_executed") throw new Error("write intent was not intercepted");
    expect(result.intendedEffects).toEqual([
      expect.objectContaining({ kind: "would_have_executed", action: "book_slot" }),
    ]);
    expect(JSON.stringify(result.intendedEffects)).not.toMatch(/slot-private|offer-private|offer-snapshot/);
    expect("actionResults" in result).toBe(false);
    expect("response" in result).toBe(false);
  });

  it("write_failure/failure não converte falha em booking concluído", async () => {
    const bookSlot = vi.fn().mockResolvedValue({
      success: false,
      reason: "slot_taken",
      evidenceRef: "failed-write",
    });
    const capability = createDentalSchedulingCapability(
      {
        listSlots: vi.fn(),
        resolveOfferedSlot: vi.fn().mockResolvedValue({
          id: "slot-1",
          label: "amanhã às 15h",
          evidenceRef: "offer-snapshot",
        }),
        resolvePendingAppointment: vi.fn(),
      },
      { bookSlot, confirmAppointment: vi.fn() },
    );
    const state = {
      phase: "awaiting_slot",
      pendingStepId: "offer-1",
      completedStepIds: [],
    };
    const claim = capability.claim(understanding("confirm-slot", {
      dialogueMove: "answers_pending",
      entities: { ordinal: 1 },
    }), state);
    if (!claim) throw new Error("expected scheduling claim");
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    const result = await capability.execute(decision, { state, policy, now: new Date(0) });

    expect(bookSlot).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      type: "appointment_create_failed",
      semanticClass: "effect_failed",
      subject: null,
      facts: [],
    });
    expect(result.evidence).toEqual([{ source: "write", reference: "failed-write" }]);
  });

  it("escalation/recovery pede ação humana sem alegar handoff concluído", async () => {
    const result = await runTurnPipeline({
      gateInput,
      state: { phase: "active", pendingStepId: null, completedStepIds: [] },
      policy,
      now: new Date(0),
      understand: async () => understanding("price-of-service", {
        safety: { requestsHuman: true },
      }),
      capabilities: [createDentalEscalationCapability()],
      outcomeSchema: DENTAL_OUTCOME_SCHEMA,
      response: { style, composer: new DeterministicResponseComposer() },
    });

    expect(result.status).toBe("delivered");
    if (result.status !== "delivered") throw new Error("escalation was not delivered");
    expect(result.actionResults).toEqual([
      expect.objectContaining({
        type: "escalation_required",
        semanticClass: "human_action_required",
        facts: [],
      }),
    ]);
    expect(result.response.text).toBe("É necessário atendimento humano.");
    expect(result.response.text).not.toMatch(/transferido|encaminhado|handoff concluído/i);
  });

  it("multi_intent/adversarial preserva subject e rejeita cross-link", async () => {
    const cleaning = { type: "service", id: "service-cleaning", displayName: "Limpeza" };
    const implant = { type: "service", id: "service-implant", displayName: "Implante" };
    const slot = { type: "slot", id: "slot-private", displayName: "sexta às 10h" };
    const evidence = { source: "read", reference: "captured-read" } as const;
    const results: ActionResult<typeof DENTAL_OUTCOME_SCHEMA>[] = [
      {
        type: "catalog_answered",
        semanticClass: "information_authorized",
        origin: { capabilityId: "dental-catalog" },
        subject: cleaning,
        evidence: [evidence],
        facts: [{
          key: "price_cents",
          value: { kind: "money", amountInMinor: 29000, currency: "BRL" },
          subject: cleaning,
          evidence,
          disclosure: "allowed",
        }],
      },
      {
        type: "slots_found",
        semanticClass: "options_found",
        origin: { capabilityId: "dental-scheduling" },
        subject: implant,
        evidence: [evidence],
        facts: [],
        options: [{
          id: "slot-private",
          subject: slot,
          facts: [{
            key: "slot_label",
            value: { kind: "display_text", value: "sexta às 10h" },
            subject: slot,
            evidence,
            disclosure: "allowed",
          }],
        }],
      },
    ];
    const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, results);
    const composer = new DeterministicResponseComposer();
    const draft = await composer.compose({ plan, style });
    const validation = validateDraft(plan, draft);
    if (!validation.valid) throw new Error("canonical draft should validate");
    const [priceAct, slotAct] = validation.draft.acts;
    if (priceAct?.kind !== "inform_fact" || slotAct?.kind !== "offer_options") {
      throw new Error("expected price and slot acts");
    }
    expect(validateDraft(plan, {
      acts: [{ ...slotAct, subjectRef: priceAct.subjectRef }],
    })).toMatchObject({
      valid: false,
      violations: expect.arrayContaining([expect.objectContaining({ code: "subject_mismatch" })]),
    });

    const response = await runV2ResponsePipeline({ plan, style, composer });
    expect(response.status).toBe("rendered");
    if (response.status !== "rendered") throw new Error("multi-intent response was not rendered");
    expect(response.response.text).toContain('Para "Limpeza", valor: R$ 290,00.');
    expect(response.response.text).toContain('Para "Implante", tenho estas opções: "sexta às 10h".');
    expect(response.response.text).not.toMatch(/service-cleaning|service-implant|slot-private|captured-read/);
  });

  it("falha fechado quando uma leitura obrigatória não foi capturada", async () => {
    const understand = vi.fn(async () => understanding("price-of-service", {
      entities: { service: "limpeza" },
    }));
    const runner = new V2ShadowRunner({ understand, hmacKey: "matrix-key", style });
    await expect(runner.run(capturedReads({
      gateInput: { status: "unavailable", reason: "not_read_by_v1" },
    }))).resolves.toEqual({ status: "unsupported", reason: "shared_read_unavailable" });
    expect(understand).not.toHaveBeenCalled();
  });
});

describe("Cycle I deferred journey boundary", () => {
  it.each(deferredRequests)("mantém %s unsupported/deferred pelo Domain Pack e runner reais", async (request) => {
    const pack = createDentalPack({
      catalogRead: { resolveService: vi.fn() },
      schedulingRead: {
        listSlots: vi.fn(),
        resolveOfferedSlot: vi.fn(),
        resolvePendingAppointment: vi.fn(),
      },
      schedulingWrite: { bookSlot: vi.fn(), confirmAppointment: vi.fn() },
    });
    expect(pack.capabilities.map(({ id }) => id)).toEqual([
      "dental-catalog",
      "dental-scheduling",
      "dental-escalation",
    ]);
    expect(pack.journeys.map(({ id }) => id)).toEqual(["price", "availability", "scheduling"]);
    const runner = new V2ShadowRunner({
      understand: async () => understanding(request as DentalRequest),
      hmacKey: "matrix-key",
      style,
    });
    await expect(runner.run(capturedReads())).resolves.toEqual({
      status: "unsupported",
      reason: "unsupported_request",
    });
  });
});
