import type { Capability, CapabilityClaim } from "@/conversation-core/capability/contract";
import type { ActionResult, Decision, Fact } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type {
  DentalAppointmentLifecycleReadPort,
  DentalAppointmentLifecycleWritePort,
  DentalAppointmentReference,
  DentalReplacementSlotSearchResult,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

function stringEntity(
  understanding: Understanding<DentalRequest>,
  key: "date" | "period" | "time" | "professional",
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

function claim(
  confidence: number,
  payload: DentalClaimPayload,
): CapabilityClaim<DentalClaimPayload> {
  return {
    capabilityId: "dental-appointment-lifecycle",
    confidence,
    reason: "structured_dental_request",
    payload,
  };
}

function appointmentFact(
  appointment: DentalAppointmentReference,
  source: "read" | "write" = "read",
): Fact {
  return {
    key: "appointment_label",
    value: { kind: "display_text", value: appointment.label },
    subject: {
      type: "appointment",
      id: appointment.id,
      displayName: appointment.label,
    },
    evidence: { source, reference: appointment.evidenceRef },
    disclosure: "allowed",
  };
}

function appointmentOptions(
  appointments: readonly DentalAppointmentReference[],
) {
  return appointments.map((appointment) => {
    const fact = appointmentFact(appointment);
    return { id: appointment.id, facts: [fact] };
  });
}

function slotFact(
  slot: DentalReplacementSlotSearchResult["slots"][number],
  source: "read" | "write" = "read",
): Fact {
  return {
    key: "slot_label",
    value: { kind: "display_text", value: slot.label },
    subject: { type: "slot", id: slot.id, displayName: slot.label },
    evidence: { source, reference: slot.evidenceRef },
    disclosure: "allowed",
  };
}

export function createDentalAppointmentLifecycleCapability(
  readPort: DentalAppointmentLifecycleReadPort,
  writePort: DentalAppointmentLifecycleWritePort,
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: "dental-appointment-lifecycle",
    claim(understanding) {
      if (understanding.request === "list-appointments") {
        return claim(understanding.confidence, {
          kind: "appointment-lifecycle",
          request: "list-appointments",
        });
      }
      if (understanding.request === "cancel-appointment") {
        return claim(understanding.confidence, {
          kind: "appointment-lifecycle",
          request: "cancel-appointment",
          ordinal: numberEntity(understanding, "ordinal"),
          date: stringEntity(understanding, "date"),
          time: stringEntity(understanding, "time"),
        });
      }
      if (understanding.request === "reschedule-appointment") {
        return claim(understanding.confidence, {
          kind: "appointment-lifecycle",
          request: "reschedule-appointment",
          ordinal: numberEntity(understanding, "ordinal"),
          requestedDate: stringEntity(understanding, "date"),
          requestedPeriod: stringEntity(understanding, "period"),
          requestedProfessional: stringEntity(understanding, "professional"),
        });
      }
      return null;
    },
    async decide(ownedClaim, context): Promise<Decision> {
      if (ownedClaim.payload.kind !== "appointment-lifecycle") {
        return { kind: "ask", questionId: "invalid-appointment-lifecycle-claim" };
      }
      if (ownedClaim.payload.request === "list-appointments") {
        const appointments = await readPort.listActiveAppointments();
        if (appointments.length === 0) {
          return { kind: "ask", questionId: "no-active-appointment" };
        }
        return {
          kind: "offer",
          subject: { type: "appointment-list", id: "active", displayName: "agendamentos" },
          options: appointmentOptions(appointments),
          nextBestStep: null,
        };
      }

      const selection = await readPort.resolveActiveAppointment({
        ordinal: ownedClaim.payload.ordinal,
        date: ownedClaim.payload.request === "cancel-appointment"
          ? ownedClaim.payload.date
          : null,
        time: ownedClaim.payload.request === "cancel-appointment"
          ? ownedClaim.payload.time
          : null,
      });
      if (selection.kind === "missing") {
        return { kind: "ask", questionId: "no-active-appointment" };
      }
      if (selection.kind === "ambiguous") {
        return {
          kind: "offer",
          subject: { type: "appointment-selection", id: "active", displayName: "agendamentos" },
          options: appointmentOptions(selection.appointments),
          nextBestStep: { id: "choose-active-appointment", repeatPolicy: "once_until_answered" },
        };
      }
      if (ownedClaim.payload.request === "cancel-appointment") {
        return {
          kind: "execute",
          action: {
            type: "cancel-appointment",
            parameters: { appointmentId: selection.appointment.id },
          },
          nextBestStep: null,
        };
      }
      const replacement = await readPort.listReplacementSlots({
        appointmentId: selection.appointment.id,
        date: ownedClaim.payload.requestedDate,
        period: ownedClaim.payload.requestedPeriod,
        professional: ownedClaim.payload.requestedProfessional,
        minimumLeadTimeHours: context.policy.schedulingMinimumLeadTimeHours,
        now: context.now,
      });
      if (replacement.slots.length === 0) {
        return { kind: "ask", questionId: "no-replacement-slots-available" };
      }
      return {
        kind: "offer",
        subject: {
          type: "service",
          id: replacement.service.id,
          displayName: replacement.service.name,
        },
        options: replacement.slots.map((slot) => ({
          id: slot.id,
          facts: [
            slotFact(slot),
            {
              key: "replacement_target",
              value: { kind: "boolean", value: true },
              subject: {
                type: "appointment",
                id: selection.appointment.id,
                displayName: selection.appointment.label,
              },
              evidence: { source: "read", reference: selection.appointment.evidenceRef },
              disclosure: "internal",
            },
          ],
        })),
        nextBestStep: { id: "choose-replacement-slot", repeatPolicy: "once_until_answered" },
      };
    },
    async execute(decision): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      if (decision.kind === "ask") {
        const noActiveFact: Fact = {
          key: "active_appointment_status",
          value: { kind: "display_text", value: "Nenhum agendamento ativo" },
          subject: {
            type: "appointment-list",
            id: "active",
            displayName: "seus agendamentos",
          },
          evidence: { source: "read", reference: "active-appointments:none" },
          disclosure: "allowed",
        };
        return {
          type: decision.questionId === "no-active-appointment"
            ? "no_active_appointment"
            : "appointment_reschedule_failed",
          semanticClass: decision.questionId === "no-active-appointment"
            ? "information_authorized"
            : "effect_failed",
          origin: { capabilityId: "dental-appointment-lifecycle" },
          subject: null,
          evidence: decision.questionId === "no-active-appointment"
            ? [noActiveFact.evidence]
            : [],
          facts: decision.questionId === "no-active-appointment" ? [noActiveFact] : [],
        } as ActionResult<typeof DENTAL_OUTCOME_SCHEMA>;
      }
      if (decision.kind === "offer") {
        if (decision.options.length === 0) throw new Error("appointment offer requires options");
        if (decision.nextBestStep?.id === "choose-replacement-slot") {
          const replacementTarget = decision.options[0]?.facts.find(
            ({ key }) => key === "replacement_target",
          )?.subject;
          if (!replacementTarget || replacementTarget.type !== "appointment") {
            throw new Error("replacement offer requires appointment binding");
          }
          const offer: DentalReplacementSlotSearchResult = {
            service: { id: decision.subject.id, name: decision.subject.displayName },
            replacesAppointmentId: replacementTarget.id,
            slots: decision.options.map((option) => {
              const fact = option.facts[0];
              if (!fact || fact.value.kind !== "display_text") {
                throw new Error("replacement slot requires bound display fact");
              }
              return {
                id: option.id,
                label: fact.value.value,
                evidenceRef: fact.evidence.reference,
              };
            }),
          };
          const persisted = await writePort.persistReplacementOffer(offer);
          if (persisted.replacesAppointmentId !== replacementTarget.id) {
            throw new Error("persisted replacement offer binding mismatch");
          }
          const facts = persisted.slots.map((slot) => slotFact(slot, "write"));
          const first = facts[0];
          if (!first) throw new Error("replacement offer requires evidence");
          return {
            type: "appointment_reschedule_offered",
            semanticClass: "options_found",
            origin: { capabilityId: "dental-appointment-lifecycle" },
            subject: decision.subject,
            evidence: [first.evidence as Fact["evidence"] & { source: "write" }, ...facts.slice(1).map(({ evidence }) => evidence)],
            facts: [],
            options: facts.map((fact, index) => ({
              id: persisted.slots[index]!.id,
              subject: fact.subject!,
              facts: [fact],
            })) as [never, ...never[]],
          };
        }
        const facts = decision.options.map((option) => appointmentFact({
          id: option.id,
          label: option.facts[0]?.value.kind === "display_text"
            ? option.facts[0].value.value
            : option.id,
          evidenceRef: option.facts[0]?.evidence.reference ?? `appointment:${option.id}`,
        }));
        const first = facts[0]!;
        return {
          type: decision.nextBestStep?.id === "choose-active-appointment"
            ? "appointment_selection_required"
            : "appointments_listed",
          semanticClass: "options_found",
          origin: { capabilityId: "dental-appointment-lifecycle" },
          subject: null,
          evidence: [first.evidence, ...facts.slice(1).map(({ evidence }) => evidence)],
          facts: [],
          options: facts.map((fact, index) => ({
            id: decision.options[index]!.id,
            subject: fact.subject!,
            facts: [fact],
          })) as [never, ...never[]],
        };
      }
      if (decision.kind === "execute" && decision.action.type === "cancel-appointment") {
        const appointmentId = decision.action.parameters.appointmentId;
        if (typeof appointmentId !== "string") {
          throw new Error("cancel appointment requires appointment id");
        }
        const outcome = await writePort.cancelAppointment(appointmentId);
        if (!outcome.success) {
          return {
            type: "appointment_cancel_failed",
            semanticClass: "effect_failed",
            origin: { capabilityId: "dental-appointment-lifecycle" },
            subject: null,
            evidence: [{ source: "write", reference: outcome.evidenceRef }],
            facts: [],
          };
        }
        const fact = appointmentFact({
          id: outcome.appointmentId,
          label: outcome.label,
          evidenceRef: outcome.evidenceRef,
        }, "write");
        return {
          type: "appointment_cancelled",
          semanticClass: "effect_completed",
          origin: { capabilityId: "dental-appointment-lifecycle" },
          subject: fact.subject!,
          evidence: [fact.evidence as Fact["evidence"] & { source: "write" }],
          facts: [fact],
        };
      }
      return {
        type: "appointment_reschedule_failed",
        semanticClass: "effect_failed",
        origin: { capabilityId: "dental-appointment-lifecycle" },
        subject: null,
        evidence: [],
        facts: [],
      };
    },
  };
}
