import type {
  Capability,
  CapabilityClaim,
} from "@/conversation-core/capability/contract";
import type {
  ActionResult,
  Decision,
  Fact,
} from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";
import type {
  DentalCatalogReadPort,
  DentalSchedulingReadPort,
  DentalSchedulingWritePort,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export type DentalPolicy = {
  priceDisclosureEnabled: boolean;
  humanEscalationRequired: boolean;
  schedulingMinimumLeadTimeHours: number;
  schedulingRequiresEvaluationFirst: boolean;
};

export type DentalCatalogClaimPayload = {
  kind: "catalog";
  request: "price-of-service" | "service-availability";
  serviceQuery: string;
};

export type DentalSchedulingClaimPayload =
  | {
      kind: "scheduling";
      request: "book-appointment";
      serviceQuery: string | null;
      requestedDate: string | null;
      requestedPeriod: string | null;
    }
  | {
      kind: "scheduling";
      request: "confirm-slot";
      pendingStepId: string | null;
      ordinal: number | null;
      requestedDate: string | null;
      requestedTime: string | null;
    }
  | {
      kind: "scheduling";
      request: "confirm-appointment";
      pendingStepId: string | null;
    };

export type DentalEscalationClaimPayload = {
  kind: "escalation";
  emergency: boolean;
  requestsHuman: boolean;
};

export type DentalClaimPayload =
  | DentalCatalogClaimPayload
  | DentalSchedulingClaimPayload
  | DentalEscalationClaimPayload;

function stringEntity(
  understanding: Understanding<DentalRequest>,
  key: "service" | "date" | "period" | "time",
): string | null {
  const value = understanding.entities[key];
  return typeof value === "string" ? value : null;
}

function numberEntity(
  understanding: Understanding<DentalRequest>,
  key: "ordinal",
): number | null {
  const value = understanding.entities[key];
  return typeof value === "number" ? value : null;
}

function ownedClaim(
  capabilityId: string,
  confidence: number,
  payload: DentalClaimPayload,
): CapabilityClaim<DentalClaimPayload> {
  return {
    capabilityId,
    confidence,
    reason: "structured_dental_request",
    payload,
  };
}

export function createDentalCatalogCapability(
  readPort: DentalCatalogReadPort,
): Capability<DentalRequest, DentalPolicy, DentalClaimPayload> {
  return {
    id: "dental-catalog",
    claim(understanding) {
      const serviceQuery = stringEntity(understanding, "service");
      if (
        (understanding.request !== "price-of-service" &&
          understanding.request !== "service-availability") ||
        !serviceQuery
      ) {
        return null;
      }
      return ownedClaim("dental-catalog", understanding.confidence, {
        kind: "catalog",
        request: understanding.request,
        serviceQuery,
      });
    },
    async decide(claim, context): Promise<Decision> {
      if (claim.payload.kind !== "catalog") {
        return { kind: "ask", questionId: "invalid-catalog-claim" };
      }
      const resolution = await readPort.resolveService(
        claim.payload.serviceQuery,
      );
      if (resolution.kind !== "exact") {
        return {
          kind: "ask",
          questionId:
            resolution.kind === "ambiguous"
              ? "choose-service"
              : "clarify-service",
        };
      }
      if (claim.payload.request === "service-availability") {
        return {
          kind: "answer",
          facts: [
            {
              key: "service_available",
              value: true,
              subject: { type: "service", id: resolution.service.id },
              evidence: { source: "read", reference: resolution.evidenceRef },
              disclosure: "allowed",
            },
          ],
          nextBestStep: null,
        };
      }
      if (
        !context.policy.priceDisclosureEnabled ||
        !resolution.service.priceDisclosable ||
        resolution.service.priceCents === null
      ) {
        return context.policy.humanEscalationRequired
          ? { kind: "escalate", reason: "price_disclosure_requires_human" }
          : { kind: "ask", questionId: "price-requires-human" };
      }
      return {
        kind: "answer",
        facts: [
          {
            key: "price_cents",
            value: resolution.service.priceCents,
            subject: { type: "service", id: resolution.service.id },
            evidence: { source: "read", reference: resolution.evidenceRef },
            disclosure: "allowed",
          },
        ],
        nextBestStep: null,
      };
    },
    async execute(decision): Promise<ActionResult> {
      if (decision.kind === "answer") {
        return {
          type: "catalog_answered",
          semanticClass: "information_authorized",
          origin: { capabilityId: "dental-catalog" },
          subject: decision.facts[0]?.subject ?? null,
          evidence: decision.facts.map(({ evidence }) => evidence),
          facts: decision.facts,
        };
      }
      return {
        type:
          decision.kind === "escalate"
            ? "escalation_required"
            : "clarification_required",
        semanticClass:
          decision.kind === "escalate"
            ? "human_action_required"
            : "clarification_required",
        origin: { capabilityId: "dental-catalog" },
        subject: null,
        evidence: [],
        facts: [],
      };
    },
  };
}

const schedulingRequests = new Set<DentalRequest>([
  "book-appointment",
  "confirm-slot",
  "confirm-appointment",
]);

export function createDentalSchedulingCapability(
  readPort: DentalSchedulingReadPort,
  writePort: DentalSchedulingWritePort,
): Capability<DentalRequest, DentalPolicy, DentalClaimPayload> {
  return {
    id: "dental-scheduling",
    claim(understanding, state) {
      if (
        !understanding.request ||
        !schedulingRequests.has(understanding.request)
      )
        return null;
      if (understanding.request === "book-appointment") {
        return ownedClaim("dental-scheduling", understanding.confidence, {
          kind: "scheduling",
          request: understanding.request,
          serviceQuery: stringEntity(understanding, "service"),
          requestedDate: stringEntity(understanding, "date"),
          requestedPeriod: stringEntity(understanding, "period"),
        });
      }
      if (understanding.request === "confirm-slot") {
        return ownedClaim("dental-scheduling", understanding.confidence, {
          kind: "scheduling",
          request: understanding.request,
          pendingStepId: state.pendingStepId,
          ordinal: numberEntity(understanding, "ordinal"),
          requestedDate: stringEntity(understanding, "date"),
          requestedTime: stringEntity(understanding, "time"),
        });
      }
      if (understanding.request !== "confirm-appointment") return null;
      return ownedClaim("dental-scheduling", understanding.confidence, {
        kind: "scheduling",
        request: understanding.request,
        pendingStepId: state.pendingStepId,
      });
    },
    async decide(claim, context): Promise<Decision> {
      if (claim.payload.kind !== "scheduling") {
        return { kind: "ask", questionId: "invalid-scheduling-claim" };
      }
      if (claim.payload.request === "book-appointment") {
        if (context.policy.schedulingRequiresEvaluationFirst)
          return { kind: "ask", questionId: "evaluation-required" };
        const slots = await readPort.listSlots({
          service: claim.payload.serviceQuery,
          date: claim.payload.requestedDate,
          period: claim.payload.requestedPeriod,
          minimumLeadTimeHours: context.policy.schedulingMinimumLeadTimeHours,
          now: context.now,
        });
        if (slots.length === 0)
          return { kind: "ask", questionId: "no-slots-available" };
        return {
          kind: "offer",
          options: slots.map((slot) => ({
            id: slot.id,
            facts: [slotFact(slot.id, slot.label, slot.evidenceRef)],
          })),
          nextBestStep: {
            id: "choose-offered-slot",
            repeatPolicy: "once_until_answered",
          },
        };
      }
      const pendingStepId = claim.payload.pendingStepId;
      if (!pendingStepId)
        return { kind: "ask", questionId: "missing-pending-selection" };
      if (claim.payload.request === "confirm-slot") {
        const slot = await readPort.resolveOfferedSlot({
          pendingStepId,
          ordinal: claim.payload.ordinal,
          date: claim.payload.requestedDate,
          time: claim.payload.requestedTime,
        });
        return slot
          ? {
              kind: "execute",
              action: { type: "book-slot", parameters: { slotId: slot.id } },
              nextBestStep: null,
            }
          : { kind: "ask", questionId: "slot-not-in-offer" };
      }
      const appointment =
        await readPort.resolvePendingAppointment(pendingStepId);
      return appointment
        ? {
            kind: "execute",
            action: {
              type: "confirm-appointment",
              parameters: { appointmentId: appointment.id },
            },
            nextBestStep: null,
          }
        : { kind: "ask", questionId: "appointment-not-found" };
    },
    async execute(decision): Promise<ActionResult> {
      if (decision.kind === "offer") {
        return {
          type: "slots_found",
          semanticClass: "options_found",
          origin: { capabilityId: "dental-scheduling" },
          subject: null,
          evidence: decision.options.flatMap(({ facts }) =>
            facts.map(({ evidence }) => evidence),
          ),
          facts: [],
          options: decision.options.map((option) => {
            const subject = option.facts[0]?.subject;
            if (!subject) throw new Error(`option ${option.id} requires a subject`);
            return { id: option.id, subject, facts: option.facts };
          }),
        };
      }
      if (decision.kind !== "execute") {
        return {
          type: "clarification_required",
          semanticClass: "clarification_required",
          origin: { capabilityId: "dental-scheduling" },
          subject: null,
          evidence: [],
          facts: [],
        };
      }
      if (
        decision.action.type !== "book-slot" &&
        decision.action.type !== "confirm-appointment"
      ) {
        return {
          type: "scheduling_failed",
          semanticClass: "effect_failed",
          origin: { capabilityId: "dental-scheduling" },
          subject: null,
          evidence: [],
          facts: [],
        };
      }
      const parameter =
        decision.action.type === "book-slot" ? "slotId" : "appointmentId";
      const id = decision.action.parameters[parameter];
      if (typeof id !== "string") {
        return {
          type: "scheduling_failed",
          semanticClass: "effect_failed",
          origin: { capabilityId: "dental-scheduling" },
          subject: null,
          evidence: [],
          facts: [],
        };
      }
      const outcome =
        decision.action.type === "book-slot"
          ? await writePort.bookSlot(id)
          : await writePort.confirmAppointment(id);
      if (!outcome.success) {
        return {
          type:
            decision.action.type === "book-slot"
              ? "appointment_create_failed"
              : "appointment_confirmation_failed",
          semanticClass: "effect_failed",
          origin: { capabilityId: "dental-scheduling" },
          subject: null,
          evidence: [{ source: "write", reference: outcome.evidenceRef }],
          facts: [],
        };
      }
      const fact = appointmentFact(
        outcome.appointmentId,
        outcome.label,
        outcome.evidenceRef,
      );
      return {
        type:
          decision.action.type === "book-slot"
            ? "appointment_created"
            : "appointment_confirmed",
        semanticClass: "effect_completed",
        origin: { capabilityId: "dental-scheduling" },
        subject: fact.subject,
        evidence: [fact.evidence],
        facts: [fact],
      };
    },
  };
}

function slotFact(id: string, label: string, evidenceRef: string): Fact {
  return {
    key: "slot_label",
    value: label,
    subject: { type: "slot", id },
    evidence: { source: "read", reference: evidenceRef },
    disclosure: "allowed",
  };
}

function appointmentFact(id: string, label: string, evidenceRef: string): Fact {
  return {
    key: "appointment_label",
    value: label,
    subject: { type: "appointment", id },
    evidence: { source: "write", reference: evidenceRef },
    disclosure: "allowed",
  };
}

export function createDentalEscalationCapability(): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload
> {
  return {
    id: "dental-escalation",
    claim(understanding) {
      return understanding.safety.emergency ||
        understanding.safety.requestsHuman
        ? {
            ...ownedClaim("dental-escalation", understanding.confidence, {
              kind: "escalation",
              emergency: understanding.safety.emergency ?? false,
              requestsHuman: understanding.safety.requestsHuman ?? false,
            }),
            conflictsWith: ["dental-catalog", "dental-scheduling"],
          }
        : null;
    },
    async decide(): Promise<Decision> {
      return { kind: "escalate", reason: "structured_safety_signal" };
    },
    async execute(): Promise<ActionResult> {
      return {
        type: "escalation_required",
        semanticClass: "human_action_required",
        origin: { capabilityId: "dental-escalation" },
        subject: null,
        evidence: [],
        facts: [],
      };
    },
  };
}
