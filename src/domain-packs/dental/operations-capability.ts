import type {
  Capability,
  CapabilityClaim,
} from "@/conversation-core/capability/contract";
import type { ActionResult, Decision, Fact } from "@/conversation-core/decision";
import type {
  DentalClaimPayload,
  DentalOperationalHandoffReason,
  DentalOperationalRequest,
  DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental/capabilities";
import type { DentalOperationsReadPort } from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const OPERATIONAL_REQUESTS = new Set<DentalRequest>([
  "clinical-urgency",
  "existing-treatment-problem",
  "patient-arrival",
  "patient-delay",
]);

const CONFLICTS = Object.freeze([
  "dental-knowledge",
  "dental-playbook-knowledge",
  "dental-explanation",
  "dental-commercial",
  "dental-catalog",
  "dental-scheduling",
  "dental-appointment-lifecycle",
  "dental-journey",
  "dental-reception",
]);

function operationalRequest(
  request: DentalRequest | null,
  emergency: boolean,
): DentalOperationalRequest | null {
  if (emergency) return "clinical-urgency";
  return request && OPERATIONAL_REQUESTS.has(request)
    ? request as DentalOperationalRequest
    : null;
}

function handoffReason(
  request: DentalOperationalRequest,
): DentalOperationalHandoffReason {
  switch (request) {
    case "clinical-urgency": return "clinical_urgency_requires_human";
    case "existing-treatment-problem": return "existing_treatment_problem_requires_human";
    case "patient-arrival": return "patient_arrival_requires_human";
    case "patient-delay": return "patient_delay_requires_human";
  }
}

function isPresenceRequest(
  request: DentalOperationalRequest,
): request is "patient-arrival" | "patient-delay" {
  return request === "patient-arrival" || request === "patient-delay";
}

function claimFor(
  confidence: number,
  request: DentalOperationalRequest,
): CapabilityClaim<DentalClaimPayload> {
  return {
    capabilityId: "dental-operations",
    confidence,
    reason: "structured_dental_operation",
    payload: {
      kind: "operations",
      request,
      reason: handoffReason(request),
    },
    conflictsWith: CONFLICTS,
  };
}

function parameter(
  parameters: Readonly<Record<string, string | number | boolean>>,
  key: string,
): string | null {
  return typeof parameters[key] === "string" ? parameters[key] : null;
}

export function createDentalOperationsCapability(
  readPort: DentalOperationsReadPort,
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: "dental-operations",
    claim(understanding) {
      const request = operationalRequest(
        understanding.request,
        understanding.safety.emergency === true,
      );
      return request ? claimFor(understanding.confidence, request) : null;
    },
    async decide(claim): Promise<Decision> {
      if (claim.payload.kind !== "operations") {
        return { kind: "ask", questionId: "invalid-operations-claim" };
      }
      const baseParameters = {
        request: claim.payload.request,
        reason: claim.payload.reason,
      };
      if (!isPresenceRequest(claim.payload.request)) {
        return {
          kind: "execute",
          action: {
            type: "require-operational-handoff",
            parameters: baseParameters,
          },
          nextBestStep: null,
        };
      }
      const resolution = await readPort.resolveTodayAppointment();
      return {
        kind: "execute",
        action: {
          type: "require-operational-handoff",
          parameters: resolution.kind === "exact"
            ? {
                ...baseParameters,
                appointmentId: resolution.appointment.id,
                appointmentLabel: resolution.appointment.label,
                evidenceRef: resolution.appointment.evidenceRef,
              }
            : baseParameters,
        },
        nextBestStep: null,
      };
    },
    async execute(decision): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      if (
        decision.kind !== "execute"
        || decision.action.type !== "require-operational-handoff"
      ) {
        return {
          type: "clarification_required",
          semanticClass: "clarification_required",
          origin: { capabilityId: "dental-operations" },
          subject: null,
          evidence: [],
          facts: [],
        };
      }
      const request = parameter(decision.action.parameters, "request");
      const reason = parameter(decision.action.parameters, "reason");
      if (
        !request
        || !OPERATIONAL_REQUESTS.has(request as DentalRequest)
        || reason !== handoffReason(request as DentalOperationalRequest)
      ) {
        throw new Error("invalid operational handoff binding");
      }
      const appointmentId = parameter(decision.action.parameters, "appointmentId");
      const appointmentLabel = parameter(decision.action.parameters, "appointmentLabel");
      const evidenceRef = parameter(decision.action.parameters, "evidenceRef");
      if ([appointmentId, appointmentLabel, evidenceRef].filter(Boolean).length % 3 !== 0) {
        throw new Error("partial appointment handoff binding");
      }
      const appointment = appointmentId && appointmentLabel && evidenceRef
        ? {
            subject: {
              type: "appointment",
              id: appointmentId,
              displayName: appointmentLabel,
            },
            evidence: { source: "read" as const, reference: evidenceRef },
          }
        : null;
      const facts: Fact[] = appointment
        ? [{
            key: "appointment_label",
            value: { kind: "display_text", value: appointment.subject.displayName },
            subject: appointment.subject,
            evidence: appointment.evidence,
            disclosure: "allowed",
          }]
        : [];
      return {
        type: isPresenceRequest(request as DentalOperationalRequest)
          ? "patient_presence_handoff"
          : "clinical_operation_handoff",
        semanticClass: "human_action_required",
        origin: { capabilityId: "dental-operations" },
        subject: appointment?.subject ?? null,
        evidence: appointment ? [appointment.evidence] : [],
        facts,
      };
    },
  };
}
