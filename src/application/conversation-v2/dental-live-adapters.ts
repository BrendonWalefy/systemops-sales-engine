import { createHash } from "node:crypto";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type {
  ConversationStateMachine,
  ConversationStateRow,
  FormattedSlot,
  SlotsOfferedPayload,
} from "@/core/conversation/ConversationStateMachine";
import type { BookingService } from "@/core/scheduling/BookingService";
import type { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import {
  ClinicTimezone,
  parseBusinessHours,
} from "@/core/scheduling/ClinicTimezone";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { Organization } from "@/domain/entities/clinic";
import type { Conversation } from "@/domain/entities/conversation";
import type { Lead } from "@/domain/entities/lead";
import type { Treatment } from "@/domain/entities/treatment";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { TreatmentRepository } from "@/domain/repositories/treatment-repository";
import type {
  DentalCatalogReadPort,
  DentalSchedulingReadPort,
  DentalSchedulingWriteOutcome,
  DentalSchedulingWritePort,
  DentalService,
  DentalSlot,
  ServiceResolution,
} from "@/domain-packs/dental/ports";

type LiveState = Pick<
  ConversationStateMachine,
  | "getCurrentState"
  | "offerSlotsForTurn"
  | "invalidateIfCurrent"
>;

export type DentalLiveAdapterDependencies = {
  treatments: Pick<TreatmentRepository, "listByClinic">;
  calendar: Pick<CalendarGateway, "listAvailableSlots">;
  state: LiveState;
  appointments: Pick<
    AppointmentRepository,
    "findByPeriod" | "findByIdForClinicAndLead"
  >;
  reservations: Pick<SlotReservationService, "findActiveByPeriod">;
  booking: Pick<BookingService, "book" | "confirmAppointment">;
  clinic: Organization;
  lead: Lead;
  leadId: string;
  conversation: Conversation;
  conversationId: string;
  turnId: string;
  now: Date;
  effectLifecycle?: Readonly<{
    attempted(): void;
    completed(): void;
  }>;
};

class DentalLiveAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DentalLiveAdapterError";
  }
}

type ExactTreatmentResolution = {
  kind: "exact";
  treatment: Treatment;
};

type TreatmentResolution =
  | ExactTreatmentResolution
  | { kind: "ambiguous"; treatments: Treatment[] }
  | { kind: "unknown" };

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

function resolveTreatment(
  tenantTreatments: readonly Treatment[],
  query: string | null,
): TreatmentResolution {
  const normalized = query ? normalize(query) : "";
  if (!normalized) return { kind: "unknown" };
  const matches = tenantTreatments.filter((treatment) =>
    [treatment.name, ...treatment.aliases].some(
      (candidate) => normalize(candidate) === normalized,
    ),
  );
  if (matches.length === 1) return { kind: "exact", treatment: matches[0]! };
  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      treatments: [...matches].sort((left, right) => left.id.localeCompare(right.id)),
    };
  }
  return { kind: "unknown" };
}

function toDentalService(treatment: Treatment): DentalService {
  return {
    id: treatment.id,
    name: treatment.name,
    priceCents: treatment.priceCents,
    priceDisclosable: treatment.priceQuotableInChat,
  };
}

function catalogEvidence(treatment: Treatment): string {
  return `treatment:${treatment.id}`;
}

function slotId(stateId: string, index: number, treatmentId: string): string {
  return `dental-slot:${encodeURIComponent(stateId)}:${index}:${encodeURIComponent(treatmentId)}`;
}

function parseSlotId(value: string): {
  stateId: string;
  index: number;
  treatmentId: string;
} | null {
  const match = /^dental-slot:([^:]+):([1-9]\d*):([^:]+)$/.exec(value);
  if (!match) return null;
  try {
    return {
      stateId: decodeURIComponent(match[1]!),
      index: Number(match[2]),
      treatmentId: decodeURIComponent(match[3]!),
    };
  } catch {
    return null;
  }
}

function slotEvidence(stateId: string, index: number): string {
  return `conversation-state:${stateId}:slot:${index}`;
}

function deterministicUuid(input: string): string {
  const bytes = Buffer.from(
    createHash("sha256").update(input).digest("hex").slice(0, 32),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function appointmentEvidence(appointmentId: string): string {
  return `appointment:${appointmentId}`;
}

function isActiveAppointment(appointment: Appointment): boolean {
  return appointment.status === "scheduled" || appointment.status === "confirmed";
}

function isExactAppointmentForSlot(
  appointment: Appointment,
  clinicId: string,
  startsAt: Date,
  endsAt: Date,
): boolean {
  return appointment.clinicId === clinicId &&
    isActiveAppointment(appointment) &&
    appointment.startsAt.getTime() === startsAt.getTime() &&
    appointment.endsAt.getTime() === endsAt.getTime();
}

function activeAppointmentForLead(
  appointments: readonly Appointment[],
  clinicId: string,
  leadId: string,
  startsAt: Date,
  endsAt: Date,
): Appointment | null {
  return appointments.find((appointment) =>
    appointment.leadId === leadId &&
    isExactAppointmentForSlot(appointment, clinicId, startsAt, endsAt),
  ) ?? null;
}

function parseOfferedPayload(state: ConversationStateRow): SlotsOfferedPayload | null {
  if (state.state !== "slots_offered") return null;
  const payload = state.payload as SlotsOfferedPayload | null;
  return payload?.slots?.length ? payload : null;
}

function datesMatch(
  timezone: ClinicTimezone,
  slot: FormattedSlot,
  requestedDate: string,
  reference: Date,
  businessHours: ReturnType<typeof parseBusinessHours>,
): boolean {
  const requested = timezone.resolvePreferredDate(
    requestedDate,
    reference,
    businessHours,
  );
  if (!requested) return false;
  const expected = timezone.toLocalParts(requested);
  const actual = timezone.toLocalParts(new Date(slot.startsAt));
  return expected.year === actual.year &&
    expected.month === actual.month &&
    expected.day === actual.day;
}

function timesMatch(
  timezone: ClinicTimezone,
  slot: FormattedSlot,
  requestedTime: string,
): boolean {
  const match = /^(\d{1,2})(?:(?:h(\d{2}))|(?::(\d{2}))|h)?$/.exec(
    normalize(requestedTime),
  );
  if (!match) return false;
  const expectedHour = Number(match[1]);
  const expectedMinute = Number(match[2] ?? match[3] ?? 0);
  if (expectedHour > 23 || expectedMinute > 59) return false;
  const actual = timezone.toLocalParts(new Date(slot.startsAt));
  return actual.hour === expectedHour && actual.minute === expectedMinute;
}

function validOfferedSlot(
  slot: FormattedSlot,
  treatment: Treatment,
): { startsAt: Date; endsAt: Date } | null {
  if (!Number.isInteger(slot.index) || slot.index < 1) return null;
  const startsAt = new Date(slot.startsAt);
  const endsAt = new Date(slot.endsAt);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt.getTime() <= startsAt.getTime() ||
    endsAt.getTime() - startsAt.getTime() !== treatment.durationMinutes * 60_000
  ) return null;
  return { startsAt, endsAt };
}

function toDentalSlot(
  stateId: string,
  slot: FormattedSlot,
  treatmentId: string,
): DentalSlot {
  return {
    id: slotId(stateId, slot.index, treatmentId),
    label: slot.label,
    evidenceRef: slotEvidence(stateId, slot.index),
  };
}

function periodMatches(
  timezone: ClinicTimezone,
  startsAt: Date,
  period: string | null,
): boolean {
  if (!period) return true;
  const hour = timezone.toLocalParts(startsAt).hour;
  switch (normalize(period)) {
    case "morning":
    case "manha":
      return hour >= 8 && hour < 12;
    case "afternoon":
    case "tarde":
      return hour >= 12 && hour < 18;
    case "evening":
    case "noite":
      return hour >= 18;
    default:
      return false;
  }
}

export function createDentalLiveAdapters(
  deps: DentalLiveAdapterDependencies,
): {
  catalogRead: DentalCatalogReadPort;
  schedulingRead: DentalSchedulingReadPort;
  schedulingWrite: DentalSchedulingWritePort;
} {
  const {
    appointments,
    booking,
    calendar,
    clinic,
    conversation,
    conversationId,
    effectLifecycle,
    lead,
    leadId,
    now: turnNow,
    reservations,
    state,
    treatments,
    turnId,
  } = deps;
  if (lead.clinicId !== clinic.id || lead.id !== leadId) {
    throw new DentalLiveAdapterError("tenant and lead binding mismatch");
  }
  if (
    conversation.id !== conversationId ||
    conversation.clinicId !== clinic.id ||
    conversation.leadId !== leadId
  ) {
    throw new DentalLiveAdapterError("conversation binding mismatch");
  }
  if (!conversationId || !turnId) {
    throw new DentalLiveAdapterError("conversation and turn binding required");
  }

  const timezone = new ClinicTimezone(clinic.timezone);
  const businessHours = parseBusinessHours(clinic.businessHours);
  let preparedSlotOffer: Readonly<{
    stateId: string;
    treatment: Treatment;
    slots: readonly { startsAt: Date; endsAt: Date }[];
    exposed: Readonly<{ service: { id: string; name: string; requiresEvaluationFirst: boolean }; slots: readonly DentalSlot[] }>;
  }> | null = null;

  async function listTenantTreatments(): Promise<Treatment[]> {
    return (await treatments.listByClinic(clinic.id)).filter(
      (treatment) => treatment.clinicId === clinic.id,
    );
  }

  async function exactTreatmentForScheduling(
    query: string | null,
  ): Promise<Treatment> {
    const tenantTreatments = await listTenantTreatments();
    const hasExplicitQuery = Boolean(query && normalize(query));
    const direct = resolveTreatment(tenantTreatments, query);
    if (direct.kind === "exact") return direct.treatment;
    if (hasExplicitQuery || direct.kind === "ambiguous") {
      throw new DentalLiveAdapterError("service resolution required");
    }

    const interest = resolveTreatment(tenantTreatments, lead.treatmentInterest);
    if (interest.kind === "exact") return interest.treatment;
    if (interest.kind === "ambiguous") {
      throw new DentalLiveAdapterError("service resolution required");
    }
    if (tenantTreatments.length === 1) return tenantTreatments[0]!;
    throw new DentalLiveAdapterError("service resolution required");
  }

  async function currentOfferedSlot(
    id: string,
  ): Promise<{
    state: ConversationStateRow;
    slot: FormattedSlot;
    treatment: Treatment;
    startsAt: Date;
    endsAt: Date;
  } | null> {
    const parsed = parseSlotId(id);
    if (!parsed) return null;
    const current = await state.getCurrentState(conversationId);
    if (
      !current ||
      current.conversationId !== conversationId ||
      current.id !== parsed.stateId
    ) return null;
    const payload = parseOfferedPayload(current);
    const offered = payload?.slots.find((slot) => slot.index === parsed.index);
    if (
      !payload ||
      !offered ||
      !payload.treatmentName ||
      payload.treatmentId !== parsed.treatmentId
    ) return null;
    const tenantTreatments = await listTenantTreatments();
    const treatment = tenantTreatments.find(
      (candidate) => candidate.id === parsed.treatmentId,
    );
    if (
      !treatment ||
      treatment.requiresEvaluationFirst ||
      normalize(treatment.name) !== normalize(payload.treatmentName)
    ) {
      return null;
    }
    if (
      payload.durationMinutes != null &&
      payload.durationMinutes !== treatment.durationMinutes
    ) return null;
    const parsedSlot = validOfferedSlot(offered, treatment);
    return parsedSlot
      ? { state: current, slot: offered, treatment, ...parsedSlot }
      : null;
  }

  async function pendingAppointment(
    expectedStateId: string | null,
    expectedAppointmentId?: string,
  ): Promise<{ appointment: Appointment; label: string; stateId: string } | null> {
    const current = await state.getCurrentState(conversationId);
    if (
      !current ||
      current.conversationId !== conversationId ||
      current.state !== "awaiting_appointment_confirmation" ||
      (expectedStateId !== null && current.id !== expectedStateId)
    ) return null;
    const payload = current.payload as {
      appointmentId?: unknown;
      appointmentLabel?: unknown;
    } | null;
    if (
      typeof payload?.appointmentId !== "string" ||
      typeof payload.appointmentLabel !== "string" ||
      (expectedAppointmentId && payload.appointmentId !== expectedAppointmentId)
    ) return null;
    const appointment = await appointments.findByIdForClinicAndLead(
      clinic.id,
      leadId,
      payload.appointmentId,
    );
    if (
      !appointment ||
      appointment.clinicId !== clinic.id ||
      appointment.leadId !== leadId ||
      !isActiveAppointment(appointment)
    ) return null;
    return { appointment, label: payload.appointmentLabel, stateId: current.id };
  }

  const catalogRead: DentalCatalogReadPort = {
    async resolveService(query): Promise<ServiceResolution> {
      const resolution = resolveTreatment(await listTenantTreatments(), query);
      if (resolution.kind === "exact") {
        return {
          kind: "exact",
          service: toDentalService(resolution.treatment),
          evidenceRef: catalogEvidence(resolution.treatment),
        };
      }
      if (resolution.kind === "ambiguous") {
        return {
          kind: "ambiguous",
          candidates: resolution.treatments.map(({ id, name }) => ({ id, name })),
          evidenceRef: `treatment-catalog:${clinic.id}`,
        };
      }
      return { kind: "unknown", evidenceRef: `treatment-catalog:${clinic.id}` };
    },
  };

  const schedulingRead: DentalSchedulingReadPort = {
    async listSlots(input) {
      const treatment = await exactTreatmentForScheduling(input.service);
      const service = {
        id: treatment.id,
        name: treatment.name,
        requiresEvaluationFirst: treatment.requiresEvaluationFirst,
      };
      if (treatment.requiresEvaluationFirst) return { service, slots: [] };
      const minimumLeadTimeMs = Math.max(0, input.minimumLeadTimeHours) * 60 * 60_000;
      const from = new Date(input.now.getTime() + minimumLeadTimeMs);
      const to = new Date(from.getTime() + clinic.slotLookaheadDays * 24 * 60 * 60_000);
      const requestedDay = input.date
        ? timezone.resolvePreferredDate(input.date, input.now, businessHours)
        : null;
      if (input.date && !requestedDay) {
        return { service, slots: [] };
      }
      const requestedParts = requestedDay
        ? timezone.toLocalParts(requestedDay)
        : null;
      const activeAppointments = await appointments.findByPeriod(clinic.id, from, to);
      const activeReservations = await reservations.findActiveByPeriod(
        clinic.id,
        from,
        to,
        input.now,
      );
      const bufferMs = clinic.postAppointmentBufferMinutes * 60_000;
      const slots = (await calendar.listAvailableSlots({
        clinicId: clinic.id,
        from,
        to,
        slotDurationMinutes: treatment.durationMinutes,
        allowedStartWindows: treatment.bookingWindows ?? null,
      }))
        .filter((slot) => slot.clinicId === clinic.id)
        .filter((slot) => slot.startsAt >= from && slot.endsAt <= to)
        .filter((slot) =>
          Number.isFinite(slot.startsAt.getTime()) &&
          Number.isFinite(slot.endsAt.getTime()) &&
          slot.endsAt.getTime() > slot.startsAt.getTime() &&
          slot.endsAt.getTime() - slot.startsAt.getTime() ===
            treatment.durationMinutes * 60_000,
        )
        .filter((slot) => {
          if (!requestedParts) return true;
          const actual = timezone.toLocalParts(slot.startsAt);
          return actual.year === requestedParts.year &&
            actual.month === requestedParts.month &&
            actual.day === requestedParts.day;
        })
        .filter((slot) => periodMatches(timezone, slot.startsAt, input.period))
        .filter((slot) => !activeAppointments.some((appointment) =>
          appointment.clinicId === clinic.id &&
          isActiveAppointment(appointment) &&
          appointment.startsAt.getTime() < slot.endsAt.getTime() &&
          appointment.endsAt.getTime() + bufferMs > slot.startsAt.getTime(),
        ))
        .filter((slot) => !activeReservations.some((reservation) =>
          reservation.clinicId === clinic.id &&
          (reservation.status === "confirmed" ||
            (reservation.status === "pending" && reservation.expiresAt > input.now)) &&
          reservation.startsAt.getTime() < slot.endsAt.getTime() &&
          reservation.endsAt.getTime() > slot.startsAt.getTime(),
        ))
        .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
        .slice(0, clinic.maxSlotsToOffer);

      if (slots.length === 0) {
        return { service, slots: [] };
      }
      const stateId = deterministicUuid(
        `conversation-v2-slot-offer:${conversationId}:${turnId}`,
      );
      const exposed = Object.freeze({
        service,
        slots: Object.freeze(slots.map((slot, index) => Object.freeze({
          id: `dental-slot-candidate:${stateId}:${index + 1}:${encodeURIComponent(treatment.id)}`,
          label: timezone.formatForHuman(slot.startsAt),
          evidenceRef: `slot-candidate:${stateId}:${index + 1}`,
        }))),
      });
      preparedSlotOffer = Object.freeze({
        stateId,
        treatment,
        slots: Object.freeze(slots.map((slot) => Object.freeze({
          startsAt: new Date(slot.startsAt.getTime()),
          endsAt: new Date(slot.endsAt.getTime()),
        }))),
        exposed,
      });
      return exposed;
    },

    async resolveOfferedSlot(input) {
      const current = await state.getCurrentState(conversationId);
      if (
        !current ||
        current.conversationId !== conversationId ||
        current.id !== input.pendingStepId
      ) return null;
      const payload = parseOfferedPayload(current);
      if (!payload) return null;
      if (!payload.treatmentId || !payload.treatmentName) return null;
      const treatment = (await listTenantTreatments()).find(
        (candidate) => candidate.id === payload.treatmentId,
      );
      if (
        !treatment ||
        treatment.requiresEvaluationFirst ||
        normalize(treatment.name) !== normalize(payload.treatmentName) ||
        (payload.durationMinutes != null &&
          payload.durationMinutes !== treatment.durationMinutes)
      ) return null;
      const matches = payload.slots.filter((slot) => {
        if (!validOfferedSlot(slot, treatment)) return false;
        if (input.ordinal !== null && slot.index !== input.ordinal) return false;
        if (
          input.date &&
          !datesMatch(timezone, slot, input.date, turnNow, businessHours)
        ) return false;
        if (input.time && !timesMatch(timezone, slot, input.time)) return false;
        return true;
      });
      if (matches.length !== 1) return null;
      return toDentalSlot(current.id, matches[0]!, treatment.id);
    },

    async resolvePendingAppointment(pendingStepId) {
      const pending = await pendingAppointment(pendingStepId);
      return pending
        ? {
            id: pending.appointment.id,
            label: pending.label,
            evidenceRef: appointmentEvidence(pending.appointment.id),
          }
        : null;
    },
  };

  function successfulOutcome(
    appointment: Appointment,
    label: string,
  ): DentalSchedulingWriteOutcome {
    return {
      success: true,
      appointmentId: appointment.id,
      label,
      evidenceRef: appointmentEvidence(appointment.id),
    };
  }

  async function invalidateConsumedStateBestEffort(stateId: string): Promise<void> {
    try {
      await state.invalidateIfCurrent(conversationId, stateId);
    } catch {
      // BookingService/confirmation success is authoritative. State cleanup must
      // never invert it or cause the action to be retried.
    }
  }

  const schedulingWrite: DentalSchedulingWritePort = {
    async persistSlotOffer(offer) {
      const prepared = preparedSlotOffer;
      if (!prepared) {
        throw new DentalLiveAdapterError("prepared slot offer unavailable");
      }
      const exactBinding = offer.service.id === prepared.exposed.service.id &&
        offer.service.name === prepared.exposed.service.name &&
        offer.slots.length === prepared.exposed.slots.length &&
        offer.slots.every((slot, index) => {
          const expected = prepared.exposed.slots[index];
          return Boolean(expected) && slot.id === expected!.id &&
            slot.label === expected!.label && slot.evidenceRef === expected!.evidenceRef;
        });
      if (!exactBinding) {
        throw new DentalLiveAdapterError("prepared slot offer binding mismatch");
      }
      // Consume before the write. A failed write is never replayed by this adapter.
      preparedSlotOffer = null;
      effectLifecycle?.attempted();
      const formatted = await state.offerSlotsForTurn(
        prepared.stateId,
        conversationId,
        prepared.slots.map(({ startsAt, endsAt }) => ({
          startsAt: new Date(startsAt.getTime()),
          endsAt: new Date(endsAt.getTime()),
        })),
        timezone,
        prepared.treatment.name,
        prepared.treatment.durationMinutes,
        clinic.slotOfferTtlMinutes,
        false,
        prepared.treatment.id,
      );
      effectLifecycle?.completed();
      if (
        formatted.length !== prepared.slots.length ||
        formatted.some((slot, index) => {
          const candidate = prepared.slots[index];
          const valid = validOfferedSlot(slot, prepared.treatment);
          return !candidate || !valid || slot.index !== index + 1 ||
            valid.startsAt.getTime() !== candidate.startsAt.getTime() ||
            valid.endsAt.getTime() !== candidate.endsAt.getTime();
        })
      ) {
        throw new DentalLiveAdapterError("persisted slot offer unavailable");
      }
      return {
        service: {
          id: prepared.treatment.id,
          name: prepared.treatment.name,
        },
        slots: formatted.map((slot) =>
          toDentalSlot(prepared.stateId, slot, prepared.treatment.id),
        ),
      };
    },

    async bookSlot(id) {
      const offered = await currentOfferedSlot(id);
      if (!offered) {
        return {
          success: false,
          reason: "stale_offer",
          evidenceRef: `booking:${turnId}:stale_offer`,
        };
      }
      const { startsAt, endsAt } = offered;
      let inPeriod = await appointments.findByPeriod(clinic.id, startsAt, endsAt);
      const existing = activeAppointmentForLead(
        inPeriod,
        clinic.id,
        leadId,
        startsAt,
        endsAt,
      );
      if (existing) {
        effectLifecycle?.completed();
        await invalidateConsumedStateBestEffort(offered.state.id);
        return successfulOutcome(existing, offered.slot.label);
      }
      if (inPeriod.some((appointment) =>
        isExactAppointmentForSlot(appointment, clinic.id, startsAt, endsAt),
      )) {
        return {
          success: false,
          reason: "slot_taken",
          evidenceRef: `booking:${turnId}:slot_taken`,
        };
      }

      effectLifecycle?.attempted();
      const result = await booking.book({
        clinic,
        lead,
        startsAt,
        endsAt,
        treatmentName: offered.treatment.name,
        treatmentId: offered.treatment.id,
        valueCents: offered.treatment.priceCents,
        origin: "ai_conversation",
      });
      if (!result.success) {
        if (result.reason === "slot_taken") {
          inPeriod = await appointments.findByPeriod(clinic.id, startsAt, endsAt);
          const reconciled = activeAppointmentForLead(
            inPeriod,
            clinic.id,
            leadId,
            startsAt,
            endsAt,
          );
          if (reconciled) {
            effectLifecycle?.completed();
            await invalidateConsumedStateBestEffort(offered.state.id);
            return successfulOutcome(reconciled, offered.slot.label);
          }
        }
        return {
          success: false,
          reason: result.reason,
          evidenceRef: `booking:${turnId}:${result.reason}`,
        };
      }
      effectLifecycle?.completed();
      if (
        result.appointment.clinicId !== clinic.id ||
        result.appointment.leadId !== leadId
      ) {
        return {
          success: false,
          reason: "invalid_booking_binding",
          evidenceRef: `booking:${turnId}:invalid_binding`,
        };
      }
      await invalidateConsumedStateBestEffort(offered.state.id);
      return successfulOutcome(result.appointment, offered.slot.label);
    },

    async confirmAppointment(appointmentId) {
      const pending = await pendingAppointment(null, appointmentId);
      if (!pending) {
        return {
          success: false,
          reason: "appointment_not_found",
          evidenceRef: `appointment-confirmation:${turnId}:not_found`,
        };
      }
      effectLifecycle?.attempted();
      const result = await booking.confirmAppointment({
        clinic,
        lead,
        appointmentId: pending.appointment.id,
      });
      if (!result.success) {
        return {
          success: false,
          reason: result.reason,
          evidenceRef: `appointment-confirmation:${turnId}:${result.reason}`,
        };
      }
      effectLifecycle?.completed();
      if (
        result.appointment.clinicId !== clinic.id ||
        result.appointment.leadId !== leadId ||
        result.appointment.id !== appointmentId
      ) {
        return {
          success: false,
          reason: "invalid_confirmation_binding",
          evidenceRef: `appointment-confirmation:${turnId}:invalid_binding`,
        };
      }
      await invalidateConsumedStateBestEffort(pending.stateId);
      return successfulOutcome(result.appointment, pending.label);
    },
  };

  return { catalogRead, schedulingRead, schedulingWrite };
}
