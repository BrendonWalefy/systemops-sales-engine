import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type {
  ConversationStateMachine,
  ConversationStateRow,
  FormattedSlot,
  SlotsOfferedPayload,
} from "@/core/conversation/ConversationStateMachine";
import type { BookingService } from "@/core/scheduling/BookingService";
import {
  ClinicTimezone,
  parseBusinessHours,
} from "@/core/scheduling/ClinicTimezone";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { Organization } from "@/domain/entities/clinic";
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
  "getCurrentState" | "getPendingSlotOffer" | "offerSlots" | "invalidate"
>;

export type DentalLiveAdapterDependencies = {
  treatments: Pick<TreatmentRepository, "listByClinic">;
  calendar: Pick<CalendarGateway, "listAvailableSlots">;
  state: LiveState;
  appointments: Pick<AppointmentRepository, "findByPeriod" | "findById">;
  booking: Pick<BookingService, "book" | "confirmAppointment">;
  clinic: Organization;
  lead: Lead;
  leadId: string;
  conversationId: string;
  turnId: string;
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
  const match = normalize(requestedTime).match(/^(\d{1,2})(?::|h)?(\d{2})?/);
  if (!match) return false;
  const expectedHour = Number(match[1]);
  const expectedMinute = Number(match[2] ?? 0);
  const actual = timezone.toLocalParts(new Date(slot.startsAt));
  return actual.hour === expectedHour && actual.minute === expectedMinute;
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
    conversationId,
    lead,
    leadId,
    state,
    treatments,
    turnId,
  } = deps;
  if (lead.clinicId !== clinic.id || lead.id !== leadId) {
    throw new DentalLiveAdapterError("tenant and lead binding mismatch");
  }
  if (!conversationId || !turnId) {
    throw new DentalLiveAdapterError("conversation and turn binding required");
  }

  const timezone = new ClinicTimezone(clinic.timezone);
  const businessHours = parseBusinessHours(clinic.businessHours);

  async function listTenantTreatments(): Promise<Treatment[]> {
    return (await treatments.listByClinic(clinic.id)).filter(
      (treatment) => treatment.clinicId === clinic.id,
    );
  }

  async function exactTreatmentForScheduling(
    query: string | null,
  ): Promise<Treatment> {
    const tenantTreatments = await listTenantTreatments();
    const direct = resolveTreatment(tenantTreatments, query);
    if (direct.kind === "exact") return direct.treatment;
    if (direct.kind === "ambiguous") {
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
    if (!treatment || normalize(treatment.name) !== normalize(payload.treatmentName)) {
      return null;
    }
    if (
      payload.durationMinutes != null &&
      payload.durationMinutes !== treatment.durationMinutes
    ) return null;
    return { state: current, slot: offered, treatment };
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
    const appointment = await appointments.findById(payload.appointmentId);
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
      const minimumLeadTimeMs = Math.max(0, input.minimumLeadTimeHours) * 60 * 60_000;
      const from = new Date(input.now.getTime() + minimumLeadTimeMs);
      const to = new Date(from.getTime() + clinic.slotLookaheadDays * 24 * 60 * 60_000);
      const requestedDay = input.date
        ? timezone.resolvePreferredDate(input.date, input.now, businessHours)
        : null;
      if (input.date && !requestedDay) {
        return { service: { id: treatment.id, name: treatment.name }, slots: [] };
      }
      const requestedParts = requestedDay
        ? timezone.toLocalParts(requestedDay)
        : null;
      const activeAppointments = await appointments.findByPeriod(clinic.id, from, to);
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
        .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
        .slice(0, clinic.maxSlotsToOffer);

      if (slots.length === 0) {
        return { service: { id: treatment.id, name: treatment.name }, slots: [] };
      }
      await state.offerSlots(
        conversationId,
        slots,
        timezone,
        treatment.name,
        treatment.durationMinutes,
        clinic.slotOfferTtlMinutes,
        false,
        treatment.id,
      );
      const persisted = await state.getCurrentState(conversationId);
      const payload = persisted ? parseOfferedPayload(persisted) : null;
      if (
        !persisted ||
        persisted.conversationId !== conversationId ||
        !payload ||
        payload.treatmentId !== treatment.id ||
        payload.treatmentName !== treatment.name ||
        payload.durationMinutes !== treatment.durationMinutes
      ) {
        throw new DentalLiveAdapterError("persisted slot offer unavailable");
      }
      return {
        service: { id: treatment.id, name: treatment.name },
        slots: payload.slots.map((slot) =>
          toDentalSlot(persisted.id, slot, treatment.id),
        ),
      };
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
        normalize(treatment.name) !== normalize(payload.treatmentName) ||
        (payload.durationMinutes != null &&
          payload.durationMinutes !== treatment.durationMinutes)
      ) return null;
      const matches = payload.slots.filter((slot) => {
        if (input.ordinal !== null && slot.index !== input.ordinal) return false;
        if (
          input.date &&
          !datesMatch(timezone, slot, input.date, current.createdAt, businessHours)
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

  const schedulingWrite: DentalSchedulingWritePort = {
    async bookSlot(id) {
      const offered = await currentOfferedSlot(id);
      if (!offered) {
        return {
          success: false,
          reason: "stale_offer",
          evidenceRef: `booking:${turnId}:stale_offer`,
        };
      }
      const startsAt = new Date(offered.slot.startsAt);
      const endsAt = new Date(offered.slot.endsAt);
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
        return {
          success: false,
          reason: "invalid_slot",
          evidenceRef: `booking:${turnId}:invalid_slot`,
        };
      }
      let inPeriod = await appointments.findByPeriod(clinic.id, startsAt, endsAt);
      const existing = activeAppointmentForLead(
        inPeriod,
        clinic.id,
        leadId,
        startsAt,
        endsAt,
      );
      if (existing) {
        await state.invalidate(conversationId);
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
            await state.invalidate(conversationId);
            return successfulOutcome(reconciled, offered.slot.label);
          }
        }
        return {
          success: false,
          reason: result.reason,
          evidenceRef: `booking:${turnId}:${result.reason}`,
        };
      }
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
      await state.invalidate(conversationId);
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
      const result = await booking.confirmAppointment({
        clinic,
        lead,
        appointment: pending.appointment,
      });
      if (!result.success) {
        return {
          success: false,
          reason: result.reason,
          evidenceRef: `appointment-confirmation:${turnId}:${result.reason}`,
        };
      }
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
      await state.invalidate(conversationId);
      return successfulOutcome(result.appointment, pending.label);
    },
  };

  return { catalogRead, schedulingRead, schedulingWrite };
}
