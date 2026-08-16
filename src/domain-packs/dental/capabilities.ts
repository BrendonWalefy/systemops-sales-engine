import type { Capability, CapabilityClaim, ConversationState } from "@/conversation-core/capability/contract";
import type { ActionResult, Decision, Fact } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";
import type { DentalCatalogReadPort, DentalSchedulingReadPort, DentalSchedulingWritePort } from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export type DentalPolicy = {
  priceDisclosureEnabled: boolean;
  humanEscalationRequired: boolean;
  schedulingMinimumLeadTimeHours: number;
  schedulingRequiresEvaluationFirst: boolean;
};

function attributesFrom(understanding: Understanding<DentalRequest>, state: ConversationState): CapabilityClaim["attributes"] {
  const attributes: Record<string, string | number | boolean | null> = {
    request: understanding.request,
    pendingStepId: state.pendingStepId,
  };
  for (const key of ["service", "date", "period", "time", "quantity", "ordinal"] as const) {
    const value = understanding.entities[key];
    if (typeof value === "string" || typeof value === "number" || value === null) attributes[key] = value;
  }
  return attributes;
}

function ownedClaim(capabilityId: string, understanding: Understanding<DentalRequest>, state: ConversationState): CapabilityClaim {
  return { capabilityId, confidence: understanding.confidence, reason: "structured_dental_request", attributes: attributesFrom(understanding, state) };
}

function stringAttribute(claim: CapabilityClaim, key: string): string | null {
  const value = claim.attributes[key];
  return typeof value === "string" ? value : null;
}

function numberAttribute(claim: CapabilityClaim, key: string): number | null {
  const value = claim.attributes[key];
  return typeof value === "number" ? value : null;
}

export function createDentalCatalogCapability(readPort: DentalCatalogReadPort): Capability<DentalRequest, DentalPolicy> {
  return {
    id: "dental-catalog",
    claim(understanding, state) {
      return (understanding.request === "price-of-service" || understanding.request === "service-availability")
        && typeof understanding.entities.service === "string"
        ? ownedClaim("dental-catalog", understanding, state)
        : null;
    },
    async decide(claim, context): Promise<Decision> {
      const serviceQuery = stringAttribute(claim, "service");
      if (!serviceQuery) return { kind: "ask", questionId: "clarify-service" };
      const resolution = await readPort.resolveService(serviceQuery);
      if (resolution.kind !== "exact") {
        return { kind: "ask", questionId: resolution.kind === "ambiguous" ? "choose-service" : "clarify-service" };
      }
      if (claim.attributes.request === "service-availability") {
        return { kind: "answer", facts: [{
          key: "service_available", value: true,
          subject: { type: "service", id: resolution.service.id },
          evidence: { source: "read", reference: resolution.evidenceRef }, disclosure: "allowed",
        }], nextBestStep: null };
      }
      if (!context.policy.priceDisclosureEnabled || !resolution.service.priceDisclosable || resolution.service.priceCents === null) {
        return { kind: "ask", questionId: "price-requires-human" };
      }
      return { kind: "answer", facts: [{
        key: "price_cents", value: resolution.service.priceCents,
        subject: { type: "service", id: resolution.service.id },
        evidence: { source: "read", reference: resolution.evidenceRef }, disclosure: "allowed",
      }], nextBestStep: null };
    },
    async execute(decision): Promise<ActionResult> {
      return decision.kind === "answer"
        ? { type: "catalog_answered", facts: decision.facts }
        : { type: "clarification_required", facts: [] };
    },
  };
}

const schedulingRequests = new Set<DentalRequest>(["book-appointment", "confirm-slot", "confirm-appointment"]);

export function createDentalSchedulingCapability(
  readPort: DentalSchedulingReadPort,
  writePort: DentalSchedulingWritePort,
): Capability<DentalRequest, DentalPolicy> {
  return {
    id: "dental-scheduling",
    claim(understanding, state) {
      return understanding.request && schedulingRequests.has(understanding.request)
        ? ownedClaim("dental-scheduling", understanding, state)
        : null;
    },
    async decide(claim, context): Promise<Decision> {
      const request = stringAttribute(claim, "request");
      if (request === "book-appointment") {
        if (context.policy.schedulingRequiresEvaluationFirst) return { kind: "ask", questionId: "evaluation-required" };
        const slots = await readPort.listSlots({
          service: stringAttribute(claim, "service"), date: stringAttribute(claim, "date"),
          period: stringAttribute(claim, "period"), minimumLeadTimeHours: context.policy.schedulingMinimumLeadTimeHours,
          now: context.now,
        });
        if (slots.length === 0) return { kind: "ask", questionId: "no-slots-available" };
        return {
          kind: "offer",
          options: slots.map((slot) => ({ id: slot.id, facts: [slotFact(slot.id, slot.label, slot.evidenceRef)] })),
          nextBestStep: { id: "choose-offered-slot", repeatPolicy: "once_until_answered" },
        };
      }
      const pendingStepId = stringAttribute(claim, "pendingStepId");
      if (!pendingStepId) return { kind: "ask", questionId: "missing-pending-selection" };
      if (request === "confirm-slot") {
        const slot = await readPort.resolveOfferedSlot({
          pendingStepId, ordinal: numberAttribute(claim, "ordinal"),
          date: stringAttribute(claim, "date"), time: stringAttribute(claim, "time"),
        });
        return slot
          ? { kind: "execute", action: { type: "book-slot", parameters: { slotId: slot.id } }, nextBestStep: null }
          : { kind: "ask", questionId: "slot-not-in-offer" };
      }
      const appointment = await readPort.resolvePendingAppointment(pendingStepId);
      return appointment
        ? { kind: "execute", action: { type: "confirm-appointment", parameters: { appointmentId: appointment.id } }, nextBestStep: null }
        : { kind: "ask", questionId: "appointment-not-found" };
    },
    async execute(decision): Promise<ActionResult> {
      if (decision.kind === "offer") return { type: "slots_found", facts: decision.options.flatMap(({ facts }) => facts) };
      if (decision.kind !== "execute") return { type: "clarification_required", facts: [] };
      const parameter = decision.action.type === "book-slot" ? "slotId" : "appointmentId";
      const id = decision.action.parameters[parameter];
      if (typeof id !== "string") return { type: "scheduling_failed", facts: [] };
      const outcome = decision.action.type === "book-slot" ? await writePort.bookSlot(id) : await writePort.confirmAppointment(id);
      if (!outcome.success) {
        return { type: decision.action.type === "book-slot" ? "appointment_create_failed" : "appointment_confirmation_failed", facts: [] };
      }
      return {
        type: decision.action.type === "book-slot" ? "appointment_created" : "appointment_confirmed",
        facts: [appointmentFact(outcome.appointmentId, outcome.label, outcome.evidenceRef)],
      };
    },
  };
}

function slotFact(id: string, label: string, evidenceRef: string): Fact {
  return { key: "slot_label", value: label, subject: { type: "slot", id }, evidence: { source: "read", reference: evidenceRef }, disclosure: "allowed" };
}

function appointmentFact(id: string, label: string, evidenceRef: string): Fact {
  return { key: "appointment_label", value: label, subject: { type: "appointment", id }, evidence: { source: "write", reference: evidenceRef }, disclosure: "allowed" };
}

export function createDentalEscalationCapability(): Capability<DentalRequest, DentalPolicy> {
  return {
    id: "dental-escalation",
    claim(understanding, state) {
      return understanding.safety.emergency || understanding.safety.requestsHuman
        ? { ...ownedClaim("dental-escalation", understanding, state), conflictsWith: ["dental-catalog", "dental-scheduling"] }
        : null;
    },
    async decide(): Promise<Decision> { return { kind: "escalate", reason: "structured_safety_signal" }; },
    async execute(): Promise<ActionResult> { return { type: "escalation_required", facts: [] }; },
  };
}
