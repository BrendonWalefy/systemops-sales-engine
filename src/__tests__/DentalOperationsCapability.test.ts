import { describe, expect, it, vi } from "vitest";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import { createDentalOperationsCapability } from "@/domain-packs/dental/operations-capability";
import type { DentalOperationsReadPort } from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const state = { phase: "idle", pendingStepId: null, completedStepIds: [] };
const context = {
  state,
  policy: {
    priceDisclosureEnabled: true,
    humanEscalationRequired: false,
    schedulingMinimumLeadTimeHours: 2,
    schedulingRequiresEvaluationFirst: false,
  },
  now: new Date("2026-09-02T12:00:00.000Z"),
};

function understanding(
  request: DentalRequest,
  safety: Readonly<{ emergency?: boolean; requestsHuman?: boolean }> = {},
): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request,
    dialogueMove: "new_topic",
    entities: {
      service: request === "existing-treatment-problem" ? "Lente" : null,
      businessInformationTopic: null,
      date: request === "patient-arrival" || request === "patient-delay" ? "hoje" : null,
      period: null,
      time: request === "patient-delay" ? "10 minutos" : null,
      professional: null,
      serviceCandidates: null,
      faqQuestion: null,
      quantity: null,
      quantityScope: null,
      objectionQuestion: null,
      ordinal: null,
    },
    signals: {
      purchaseIntent: null,
      priceSensitivity: null,
      sentiment: null,
      objection: null,
    },
    safety: {
      optOut: false,
      emergency: safety.emergency ?? false,
      requestsHuman: safety.requestsHuman ?? false,
    },
    confidence: 1,
    ambiguity: null,
  };
}

function port(
  result: Awaited<ReturnType<DentalOperationsReadPort["resolveTodayAppointment"]>> = {
    kind: "none",
  },
) {
  return {
    resolveTodayAppointment: vi.fn().mockResolvedValue(result),
  } satisfies DentalOperationsReadPort;
}

describe("dental operations capability", () => {
  it.each([
    ["clinical-urgency", "clinical_urgency_requires_human"],
    ["existing-treatment-problem", "existing_treatment_problem_requires_human"],
  ] as const)("closes %s as a clinical handoff", async (request, reason) => {
    const read = port();
    const capability = createDentalOperationsCapability(read);
    const claim = capability.claim(understanding(request), state)!;

    expect(claim).toMatchObject({
      capabilityId: "dental-operations",
      payload: { kind: "operations", request, reason },
    });
    expect(claim.conflictsWith).toEqual(expect.arrayContaining([
      "dental-commercial",
      "dental-scheduling",
      "dental-reception",
    ]));
    const decision = await capability.decide(claim, context);
    const result = await capability.execute(decision, context);

    expect(decision).toMatchObject({
      kind: "execute",
      action: { type: "require-operational-handoff", parameters: { reason } },
    });
    expect(result).toMatchObject({
      type: "clinical_operation_handoff",
      semanticClass: "human_action_required",
      origin: { capabilityId: "dental-operations" },
      subject: null,
      evidence: [],
      facts: [expect.objectContaining({
        key: "operational_handoff_reason",
        value: { kind: "display_text", value: reason },
        disclosure: "internal",
      })],
    });
    expect(read.resolveTodayAppointment).not.toHaveBeenCalled();
  });

  it.each([
    ["patient-arrival", "patient_arrival_requires_human"],
    ["patient-delay", "patient_delay_requires_human"],
  ] as const)("binds one exact appointment for %s", async (request, reason) => {
    const read = port({
      kind: "exact",
      appointment: {
        id: "appointment-1",
        label: "Hoje às 10h",
        evidenceRef: "appointment:appointment-1",
      },
    });
    const capability = createDentalOperationsCapability(read);
    const claim = capability.claim(understanding(request), state)!;
    const decision = await capability.decide(claim, context);
    const result = await capability.execute(decision, context);

    expect(result).toMatchObject({
      type: "patient_presence_handoff",
      semanticClass: "human_action_required",
      subject: { type: "appointment", id: "appointment-1", displayName: "Hoje às 10h" },
      evidence: [{ source: "read", reference: "appointment:appointment-1" }],
      facts: expect.arrayContaining([expect.objectContaining({
        key: "operational_handoff_reason",
        value: { kind: "display_text", value: reason },
        disclosure: "internal",
      })]),
    });
    expect(decision).toMatchObject({
      kind: "execute",
      action: { parameters: { reason, appointmentId: "appointment-1" } },
    });
  });

  it.each([{ kind: "none" }, { kind: "ambiguous" }] as const)(
    "never fabricates an appointment for $kind resolution",
    async (resolution) => {
      const capability = createDentalOperationsCapability(port(resolution));
      const claim = capability.claim(understanding("patient-arrival"), state)!;
      const result = await capability.execute(
        await capability.decide(claim, context),
        context,
      );

      expect(result).toMatchObject({
        type: "patient_presence_handoff",
        subject: null,
        evidence: [],
      });
    },
  );

  it("claims an emergency signal even when the request is otherwise social", async () => {
    const capability = createDentalOperationsCapability(port());
    const claim = capability.claim(
      understanding("other", { emergency: true }),
      state,
    )!;
    expect(claim.payload).toMatchObject({
      kind: "operations",
      request: "clinical-urgency",
      reason: "clinical_urgency_requires_human",
    });
  });

  it("does not claim ordinary human requests owned by dental-escalation", () => {
    const capability = createDentalOperationsCapability(port());
    expect(capability.claim(
      understanding("other", { requestsHuman: true }),
      state,
    )).toBeNull();
  });
});
