import type {
  Capability,
  CapabilityClaim,
} from "@/conversation-core/capability/contract";
import type {
  ActionResult,
  Decision,
  Fact,
  OutcomeTypeOf,
} from "@/conversation-core/decision";
import { defineOutcomeSchema } from "@/conversation-core/decision";
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

export type DentalReceptionClaimPayload = {
  kind: "reception";
  request: "greeting" | "other";
};

export type DentalEscalationClaimPayload = {
  kind: "escalation";
  emergency: boolean;
  requestsHuman: boolean;
};

export type DentalClaimPayload =
  | DentalCatalogClaimPayload
  | DentalSchedulingClaimPayload
  | DentalEscalationClaimPayload
  | DentalReceptionClaimPayload;

export const DENTAL_OUTCOME_SCHEMA = defineOutcomeSchema({
  catalog_answered: {
    semanticClass: "information_authorized",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
  slots_found: {
    semanticClass: "options_found",
    subjectRequirement: "required",
    evidenceRequirement: "required",
  },
  appointment_created: {
    semanticClass: "effect_completed",
    subjectRequirement: "required",
    evidenceRequirement: "write_required",
  },
  appointment_confirmed: {
    semanticClass: "effect_completed",
    subjectRequirement: "required",
    evidenceRequirement: "write_required",
  },
  appointment_create_failed: {
    semanticClass: "effect_failed",
    subjectRequirement: "optional",
    evidenceRequirement: "write_required",
  },
  appointment_confirmation_failed: {
    semanticClass: "effect_failed",
    subjectRequirement: "optional",
    evidenceRequirement: "write_required",
  },
  scheduling_failed: {
    semanticClass: "effect_failed",
    subjectRequirement: "optional",
    evidenceRequirement: "optional",
  },
  escalation_required: {
    semanticClass: "human_action_required",
    subjectRequirement: "forbidden",
    evidenceRequirement: "optional",
  },
  reception_answered: {
    semanticClass: "engagement_invited",
    subjectRequirement: "forbidden",
    evidenceRequirement: "optional",
  },
  clarification_required: {
    semanticClass: "clarification_required",
    subjectRequirement: "forbidden",
    evidenceRequirement: "optional",
  },
} as const);

export type DentalOutcomeType = OutcomeTypeOf<typeof DENTAL_OUTCOME_SCHEMA>;

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
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
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
              value: { kind: "boolean", value: true },
              subject: {
                type: "service",
                id: resolution.service.id,
                displayName: resolution.service.name,
              },
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
            value: {
              kind: "money",
              amountInMinor: resolution.service.priceCents,
              currency: "BRL",
            },
            subject: {
              type: "service",
              id: resolution.service.id,
              displayName: resolution.service.name,
            },
            evidence: { source: "read", reference: resolution.evidenceRef },
            disclosure: "allowed",
          },
        ],
        nextBestStep: null,
      };
    },
    async execute(decision): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      if (decision.kind === "answer") {
        const firstFact = decision.facts[0];
        if (!firstFact?.subject) {
          throw new Error("catalog_answered requires a subject");
        }
        const [firstEvidence, ...remainingEvidence] = decision.facts.map(
          ({ evidence }) => evidence,
        );
        if (!firstEvidence) {
          throw new Error("catalog_answered requires evidence");
        }
        return {
          type: "catalog_answered",
          semanticClass: "information_authorized",
          origin: { capabilityId: "dental-catalog" },
          subject: firstFact.subject,
          evidence: [firstEvidence, ...remainingEvidence],
          facts: decision.facts,
        };
      }
      if (decision.kind === "escalate") {
        return {
          type: "escalation_required",
          semanticClass: "human_action_required",
          origin: { capabilityId: "dental-catalog" },
          subject: null,
          evidence: [],
          facts: [],
        };
      }
      return {
        type: "clarification_required",
        semanticClass: "clarification_required",
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
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
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
        const availability = await readPort.listSlots({
          service: claim.payload.serviceQuery,
          date: claim.payload.requestedDate,
          period: claim.payload.requestedPeriod,
          minimumLeadTimeHours: context.policy.schedulingMinimumLeadTimeHours,
          now: context.now,
        });
        if (
          context.policy.schedulingRequiresEvaluationFirst
          || availability.service.requiresEvaluationFirst
        ) return { kind: "ask", questionId: "evaluation-required" };
        if (availability.slots.length === 0)
          return { kind: "ask", questionId: "no-slots-available" };
        return {
          kind: "offer",
          subject: {
            type: "service",
            id: availability.service.id,
            displayName: availability.service.name,
          },
          options: availability.slots.map((slot) => ({
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
    async execute(decision): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      if (decision.kind === "offer") {
        if (decision.options.length === 0) {
          return {
            type: "clarification_required",
            semanticClass: "clarification_required",
            origin: { capabilityId: "dental-scheduling" },
            subject: null,
            evidence: [],
            facts: [],
          };
        }
        const candidateSlots = decision.options.map((option) => {
          const fact = option.facts.find(({ key }) => key === "slot_label");
          if (
            !fact?.subject ||
            fact.subject.id !== option.id ||
            fact.value.kind !== "display_text"
          ) {
            throw new Error(`option ${option.id} requires a bound slot label`);
          }
          return {
            id: option.id,
            label: fact.value.value,
            evidenceRef: fact.evidence.reference,
          };
        });
        const persisted = await writePort.persistSlotOffer({
          service: {
            id: decision.subject.id,
            name: decision.subject.displayName,
            requiresEvaluationFirst: false,
          },
          slots: candidateSlots,
        });
        if (
          persisted.service.id !== decision.subject.id ||
          persisted.service.name !== decision.subject.displayName ||
          persisted.slots.length !== candidateSlots.length
        ) {
          throw new Error("persisted slot offer binding mismatch");
        }
        const toResultOption = (slot: (typeof persisted.slots)[number]) => {
          const fact = slotFact(slot.id, slot.label, slot.evidenceRef, "write");
          return { id: slot.id, subject: fact.subject!, facts: [fact] };
        };
        const evidence = persisted.slots.map((slot) => ({
          source: "write" as const,
          reference: slot.evidenceRef,
        }));
        const [firstEvidence, ...remainingEvidence] = evidence;
        if (!firstEvidence) {
          throw new Error("slots_found requires evidence");
        }
        return {
          type: "slots_found",
          semanticClass: "options_found",
          origin: { capabilityId: "dental-scheduling" },
          subject: decision.subject,
          evidence: [firstEvidence, ...remainingEvidence],
          facts: [],
          options: [toResultOption(persisted.slots[0]!), ...persisted.slots.slice(1).map(toResultOption)],
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

function slotFact(
  id: string,
  label: string,
  evidenceRef: string,
  source: "read" | "write" = "read",
): Fact {
  return {
    key: "slot_label",
    value: { kind: "display_text", value: label },
    subject: { type: "slot", id, displayName: label },
    evidence: { source, reference: evidenceRef },
    disclosure: "allowed",
  };
}

function appointmentFact(
  id: string,
  label: string,
  evidenceRef: string,
): Fact & {
  subject: NonNullable<Fact["subject"]>;
  evidence: Fact["evidence"] & { source: "write" };
} {
  return {
    key: "appointment_label",
    value: { kind: "display_text", value: label },
    subject: { type: "appointment", id, displayName: label },
    evidence: { source: "write", reference: evidenceRef },
    disclosure: "allowed",
  };
}

export function createDentalEscalationCapability(): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
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
    async execute(): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
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


/**
 * Abertura social e pedido fora do catálogo transacional.
 *
 * Sem esta capability nenhuma outra reivindica o turno, o coordinator não tem o
 * que decidir e o lead fica sem resposta — que era o comportamento observado
 * para "oi", "bom dia" e qualquer mensagem que não fosse preço, disponibilidade
 * ou agendamento.
 */
export function createDentalReceptionCapability(): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: "dental-reception",
    claim(understanding) {
      if (understanding.request !== "greeting" && understanding.request !== "other") return null;
      if (understanding.safety.emergency || understanding.safety.requestsHuman) return null;
      return ownedClaim("dental-reception", understanding.confidence, {
        kind: "reception",
        request: understanding.request,
      });
    },
    async decide(): Promise<Decision> {
      return { kind: "ask", questionId: "reception-how-can-i-help" };
    },
    async execute(): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      return {
        type: "reception_answered",
        semanticClass: "engagement_invited",
        origin: { capabilityId: "dental-reception" },
        subject: null,
        evidence: [],
        facts: [],
      };
    },
  };
}
