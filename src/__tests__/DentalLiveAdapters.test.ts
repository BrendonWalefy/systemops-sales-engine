import { describe, expect, it, vi } from "vitest";
import { createDentalLiveAdapters } from "@/application/conversation-v2/dental-live-adapters";
import type { Organization } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { Treatment } from "@/domain/entities/treatment";
import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";
import type { Conversation } from "@/domain/entities/conversation";
import type { SlotReservation } from "@/core/scheduling/SlotReservationService";
import type {
  ConversationStateRow,
  FormattedSlot,
} from "@/core/conversation/ConversationStateMachine";

const now = new Date("2026-08-17T12:00:00.000Z");
const startsAt = new Date("2026-08-18T18:00:00.000Z");
const endsAt = new Date("2026-08-18T19:00:00.000Z");

const clinic: Organization = {
  id: "clinic-lab",
  name: "SystemOps Dental Lab",
  specialty: "odontologia",
  segment: "dental",
  city: null,
  address: null,
  addressComplement: null,
  mapsUrl: null,
  locationMessage: null,
  timezone: "America/Sao_Paulo",
  greetingMessage: null,
  menuItems: null,
  businessHours: "Seg-Sex 8h-18h",
  googleCalendarId: null,
  calendarMode: "internal",
  receptionistPhone: null,
  takeoverTtlHours: 4,
  postAppointmentBufferMinutes: 0,
  defaultAppointmentDurationMinutes: 60,
  rateLimitPerHour: 60,
  unclearThreshold: 3,
  staleConversationHours: 4,
  slotOfferTtlMinutes: 15,
  maxSlotsToOffer: 3,
  slotLookaheadDays: 14,
  mediaTakeoverTtlHours: null,
  rapidThrottleMs: 0,
  messageDebounceMs: null,
  serviceNoun: "tratamento",
  bookingNoun: "consulta",
  contactNoun: "paciente",
  agentRole: "recepcionista virtual",
  businessDescriptor: null,
  businessNoun: "clínica",
  createdAt: now,
  updatedAt: now,
};

const lead: Lead = {
  id: "lead-lab",
  clinicId: clinic.id,
  name: "Pessoa Lab",
  phone: null,
  whatsappLid: "lab-persona-1@lid",
  email: null,
  channel: "whatsapp",
  campaignId: null,
  treatmentInterest: null,
  profilePicUrl: null,
  status: "in_conversation",
  temperature: null,
  assignedToUserId: null,
  nextActionAt: null,
  lostReason: null,
  createdAt: now,
  updatedAt: now,
};

const conversation: Conversation = {
  id: "conversation-lab",
  clinicId: clinic.id,
  leadId: lead.id,
  channel: "whatsapp",
  category: "sales",
  externalThreadId: null,
  summary: null,
  aiPaused: false,
  takeoverExpiresAt: null,
  needsAttention: false,
  attentionReason: null,
  consecutiveUnclearCount: 0,
  lastMessageAt: now,
  createdAt: now,
  updatedAt: now,
};

function treatment(
  overrides: Partial<Treatment> = {},
): Treatment {
  return {
    id: "treatment-whitening",
    clinicId: clinic.id,
    name: "Clareamento",
    durationMinutes: 60,
    description: null,
    requiresEvaluationFirst: false,
    keywordMatchEnabled: true,
    aliases: ["branqueamento"],
    isAesthetic: true,
    pipelineSteps: null,
    pipelineSourceTreatmentId: null,
    pipelineEntryBehavior: null,
    priceCents: 90_000,
    minPriceCents: null,
    maxPriceCents: null,
    priceQuotableInChat: true,
    priceKind: "fixed",
    priceUnit: null,
    priceDeductible: false,
    quantityPrices: null,
    bookingWindows: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function appointment(
  overrides: Partial<Appointment> = {},
): Appointment {
  return {
    id: "appointment-1",
    clinicId: clinic.id,
    leadId: lead.id,
    professionalId: null,
    roomId: null,
    calendarEventId: null,
    calendarEventUrl: null,
    startsAt,
    endsAt,
    status: "scheduled",
    source: "app",
    origin: "ai_conversation",
    reminderSentAt: null,
    treatmentId: "treatment-whitening",
    valueCents: 90_000,
    description: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setup(options: {
  treatments?: Treatment[];
  leadOverride?: Lead;
  calendarSlots?: CalendarSlot[];
  appointmentsInPeriod?: Appointment[];
  appointmentById?: Appointment | null;
  reservationsInPeriod?: SlotReservation[];
  conversationOverride?: Conversation;
} = {}) {
  const availableTreatments = options.treatments ?? [treatment()];
  const activeLead = options.leadOverride ?? lead;
  let currentState: ConversationStateRow | null = null;
  let stateSequence = 0;

  const state = {
    getCurrentState: vi.fn(async () => currentState),
    getPendingSlotOffer: vi.fn(async () => {
      if (currentState?.state !== "slots_offered") return null;
      return (currentState.payload as { slots: FormattedSlot[] }).slots;
    }),
    offerSlots: vi.fn(async (
      _conversationId: string,
      slots: Array<{ startsAt: Date; endsAt: Date }>,
      timezone: { formatForHuman(value: Date): string },
      treatmentName?: string,
      durationMinutes?: number,
      _ttlMinutes?: number,
      _voiceEnabled?: boolean,
      treatmentId?: string,
    ) => {
      const formatted = slots.map((slot, index) => ({
        index: index + 1,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        label: timezone.formatForHuman(slot.startsAt),
      }));
      stateSequence += 1;
      currentState = {
        id: `offer-state-${stateSequence}`,
        conversationId: "conversation-lab",
        state: "slots_offered",
        payload: {
          slots: formatted,
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
          treatmentName,
          treatmentId,
          durationMinutes,
        },
        supersedesStateId: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 15 * 60_000),
      };
      return formatted;
    }),
    offerSlotsForTurn: vi.fn(async (
      stateId: string,
      _conversationId: string,
      slots: Array<{ startsAt: Date; endsAt: Date }>,
      timezone: { formatForHuman(value: Date): string },
      treatmentName?: string,
      durationMinutes?: number,
      _ttlMinutes?: number,
      _voiceEnabled?: boolean,
      treatmentId?: string,
    ) => {
      const formatted = slots.map((slot, index) => ({
        index: index + 1,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        label: timezone.formatForHuman(slot.startsAt),
      }));
      currentState = {
        id: stateId,
        conversationId: "conversation-lab",
        state: "slots_offered",
        payload: {
          slots: formatted,
          expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
          treatmentName,
          treatmentId,
          durationMinutes,
        },
        supersedesStateId: null,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 15 * 60_000),
      };
      return formatted;
    }),
    invalidate: vi.fn(async () => {
      currentState = {
        id: "idle-state",
        conversationId: "conversation-lab",
        state: "idle",
        payload: null,
        supersedesStateId: null,
        createdAt: now,
        expiresAt: null,
      };
    }),
    invalidateIfCurrent: vi.fn(async (_conversationId: string, expectedStateId: string) => {
      if (currentState?.id !== expectedStateId) return false;
      currentState = {
        id: "idle-state",
        conversationId: "conversation-lab",
        state: "idle",
        payload: null,
        supersedesStateId: expectedStateId,
        createdAt: now,
        expiresAt: null,
      };
      return true;
    }),
  };

  const appointments = {
    findByPeriod: vi.fn().mockResolvedValue(options.appointmentsInPeriod ?? []),
    findById: vi.fn().mockResolvedValue(options.appointmentById ?? null),
    findByIdForClinicAndLead: vi.fn().mockImplementation(async (
      clinicId: string,
      leadId: string,
      appointmentId: string,
    ) => {
      const candidate = options.appointmentById ?? null;
      return candidate?.id === appointmentId &&
        candidate.clinicId === clinicId && candidate.leadId === leadId
        ? candidate
        : null;
    }),
  };
  const booking = {
    book: vi.fn().mockResolvedValue({ success: true, appointment: appointment() }),
    confirmAppointment: vi.fn().mockImplementation(async ({ appointmentId }) => {
      const input = options.appointmentById ?? null;
      return input?.id === appointmentId
        ? { success: true, appointment: { ...input, status: "confirmed" } }
        : { success: false, reason: "appointment_not_found" };
    }),
  };
  const calendarSlots = options.calendarSlots ?? [{
    id: "calendar-slot-1",
    clinicId: clinic.id,
    professionalId: null,
    startsAt,
    endsAt,
    source: "manual" as const,
  }];
  const calendar = {
    listAvailableSlots: vi.fn().mockResolvedValue(calendarSlots),
  };
  const treatments = {
    listByClinic: vi.fn().mockResolvedValue(availableTreatments),
  };
  const reservations = {
    findActiveByPeriod: vi.fn().mockResolvedValue(options.reservationsInPeriod ?? []),
  };

  const adapters = createDentalLiveAdapters({
    treatments,
    calendar,
    state,
    appointments,
    reservations,
    booking,
    clinic,
    lead: activeLead,
    leadId: activeLead.id,
    conversation: options.conversationOverride ?? conversation,
    conversationId: "conversation-lab",
    turnId: "turn-1",
    now,
  });

  return {
    adapters,
    appointments,
    booking,
    calendar,
    reservations,
    getCurrentState: () => currentState,
    setCurrentState: (next: ConversationStateRow | null) => { currentState = next; },
    state,
    treatments,
  };
}

async function discoverOneSlot(fixture: ReturnType<typeof setup>) {
  return fixture.adapters.schedulingRead.listSlots({
    service: "clareamento",
    date: "amanhã",
    period: "afternoon",
    minimumLeadTimeHours: 2,
    now,
  });
}

async function offerOneSlot(fixture: ReturnType<typeof setup>) {
  const discovered = await discoverOneSlot(fixture);
  return fixture.adapters.schedulingWrite.persistSlotOffer(discovered);
}

describe("Dental live adapters — tenant-scoped catalog", () => {
  it("resolves price only from an exact tenant treatment or alias", async () => {
    const foreign = treatment({ id: "foreign", clinicId: "other-clinic", priceCents: 1 });
    const { adapters, treatments } = setup({ treatments: [foreign, treatment()] });

    await expect(adapters.catalogRead.resolveService("  BRANQUEAMENTO ")).resolves.toMatchObject({
      kind: "exact",
      service: {
        id: "treatment-whitening",
        name: "Clareamento",
        priceCents: 90_000,
        priceDisclosable: true,
      },
    });
    expect(treatments.listByClinic).toHaveBeenCalledWith(clinic.id);
  });

  it("returns ambiguity instead of selecting one of multiple exact aliases", async () => {
    const { adapters } = setup({
      treatments: [
        treatment({ id: "a", name: "Clareamento A", aliases: ["clareamento"] }),
        treatment({ id: "b", name: "Clareamento B", aliases: ["clareamento"] }),
      ],
    });

    await expect(adapters.catalogRead.resolveService("clareamento")).resolves.toMatchObject({
      kind: "ambiguous",
      candidates: [{ id: "a" }, { id: "b" }],
    });
  });

  it("rejects a dependency graph whose lead is not bound to the exact tenant and lead id", () => {
    const fixture = setup();
    expect(() => createDentalLiveAdapters({
      treatments: fixture.treatments,
      calendar: fixture.calendar,
      state: fixture.state,
      appointments: fixture.appointments,
      reservations: fixture.reservations,
      booking: fixture.booking,
      clinic,
      lead: { ...lead, clinicId: "other-clinic" },
      leadId: lead.id,
      conversation,
      conversationId: "conversation-lab",
      turnId: "turn-1",
      now,
    })).toThrow(/tenant.*lead binding/i);
  });

  it("rejects an authoritative conversation that is not bound to the exact tenant and lead", () => {
    expect(() => setup({
      conversationOverride: { ...conversation, clinicId: "other-clinic" },
    })).toThrow(/conversation binding/i);
    expect(() => setup({
      conversationOverride: { ...conversation, leadId: "other-lead" },
    })).toThrow(/conversation binding/i);
    expect(() => setup({
      conversationOverride: { ...conversation, id: "other-conversation" },
    })).toThrow(/conversation binding/i);
  });
});

describe("Dental live adapters — persisted offers", () => {
  it("persists only tenant slots and binds their ids to the current offer state and index", async () => {
    const foreignSlot: CalendarSlot = {
      id: "foreign-slot",
      clinicId: "other-clinic",
      professionalId: null,
      startsAt,
      endsAt,
      source: "manual",
    };
    const fixture = setup({ calendarSlots: [foreignSlot, {
      id: "tenant-slot",
      clinicId: clinic.id,
      professionalId: null,
      startsAt,
      endsAt,
      source: "manual",
    }] });

    const discovered = await discoverOneSlot(fixture);
    expect(fixture.getCurrentState()).toBeNull();
    expect(fixture.state.offerSlotsForTurn).not.toHaveBeenCalled();

    const result = await fixture.adapters.schedulingWrite.persistSlotOffer(discovered);
    const stateId = fixture.getCurrentState()?.id;
    expect(result.service).toEqual({ id: "treatment-whitening", name: "Clareamento" });
    expect(result.slots).toHaveLength(1);
    expect(fixture.state.offerSlots).not.toHaveBeenCalled();
    expect(fixture.state.offerSlotsForTurn).toHaveBeenCalledOnce();
    expect(fixture.state.offerSlotsForTurn).toHaveBeenCalledWith(
      expect.any(String),
      conversation.id,
      [{ startsAt, endsAt }],
      expect.anything(),
      "Clareamento",
      60,
      15,
      false,
      "treatment-whitening",
    );

    await expect(fixture.adapters.schedulingRead.resolveOfferedSlot({
      pendingStepId: stateId!,
      ordinal: 1,
      date: null,
      time: null,
    })).resolves.toEqual(result.slots[0]);

    fixture.setCurrentState({ ...fixture.getCurrentState()!, id: "replacement-state" });
    await expect(fixture.adapters.schedulingRead.resolveOfferedSlot({
      pendingStepId: stateId!,
      ordinal: 1,
      date: null,
      time: null,
    })).resolves.toBeNull();
  });

  it("uses exact lead treatment interest, then a sole eligible treatment, and never guesses among many", async () => {
    const whitening = treatment();
    const evaluation = treatment({ id: "evaluation", name: "Avaliação", aliases: [] });
    const withInterest = setup({
      treatments: [whitening, evaluation],
      leadOverride: { ...lead, treatmentInterest: "avaliação" },
    });
    await expect(withInterest.adapters.schedulingRead.listSlots({
      service: null,
      date: null,
      period: null,
      minimumLeadTimeHours: 2,
      now,
    })).resolves.toMatchObject({ service: { id: "evaluation" } });

    const sole = setup({ treatments: [whitening] });
    await expect(sole.adapters.schedulingRead.listSlots({
      service: null,
      date: null,
      period: null,
      minimumLeadTimeHours: 2,
      now,
    })).resolves.toMatchObject({ service: { id: "treatment-whitening" } });

    const unresolved = setup({ treatments: [whitening, evaluation] });
    await expect(unresolved.adapters.schedulingRead.listSlots({
      service: null,
      date: null,
      period: null,
      minimumLeadTimeHours: 2,
      now,
    })).rejects.toThrow(/service resolution required/i);
    expect(unresolved.calendar.listAvailableSlots).not.toHaveBeenCalled();
  });

  it("fails closed for an explicit unknown service instead of falling back to lead interest or a sole treatment", async () => {
    const fixture = setup({
      leadOverride: { ...lead, treatmentInterest: "clareamento" },
    });
    await expect(fixture.adapters.schedulingRead.listSlots({
      service: "implante",
      date: null,
      period: null,
      minimumLeadTimeHours: 2,
      now,
    })).rejects.toThrow(/service resolution required/i);
    expect(fixture.calendar.listAvailableSlots).not.toHaveBeenCalled();
  });

  it("excludes slots overlapping an active tenant reservation", async () => {
    const fixture = setup({
      reservationsInPeriod: [{
        id: "reservation-1",
        clinicId: clinic.id,
        leadId: "other-lead",
        startsAt,
        endsAt,
        status: "pending",
        calendarEventId: null,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      }],
    });
    await expect(discoverOneSlot(fixture)).resolves.toMatchObject({ slots: [] });
    expect(fixture.reservations.findActiveByPeriod).toHaveBeenCalledWith(
      clinic.id,
      expect.any(Date),
      expect.any(Date),
      now,
    );
    expect(fixture.state.offerSlots).not.toHaveBeenCalled();
    expect(fixture.state.offerSlotsForTurn).not.toHaveBeenCalled();
  });
});

describe("Dental live adapters — BookingService write boundary", () => {
  it("books only through BookingService after revalidating persisted state, slot, and service", async () => {
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    const offeredStateId = fixture.getCurrentState()!.id;

    const result = await fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id);

    expect(result).toMatchObject({ success: true, appointmentId: "appointment-1" });
    expect(fixture.appointments.findByPeriod).toHaveBeenCalledWith(clinic.id, startsAt, endsAt);
    expect(fixture.booking.book).toHaveBeenCalledOnce();
    expect(fixture.booking.book).toHaveBeenCalledWith({
      clinic,
      lead,
      startsAt,
      endsAt,
      treatmentName: "Clareamento",
      treatmentId: "treatment-whitening",
      valueCents: 90_000,
      origin: "ai_conversation",
    });
    expect(fixture.state.invalidateIfCurrent).toHaveBeenCalledWith(
      "conversation-lab",
      offeredStateId,
    );
  });

  it("returns the existing exact same-lead active appointment on retry without booking again", async () => {
    const existing = appointment({ id: "existing-appointment" });
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    const offeredStateId = fixture.getCurrentState()!.id;
    fixture.appointments.findByPeriod.mockResolvedValue([existing]);

    await expect(fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id)).resolves.toMatchObject({
      success: true,
      appointmentId: existing.id,
    });
    expect(fixture.booking.book).not.toHaveBeenCalled();
    expect(fixture.state.invalidateIfCurrent).toHaveBeenCalledWith(
      "conversation-lab",
      offeredStateId,
    );
  });

  it("keeps an authoritative booking success when best-effort state cleanup throws", async () => {
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    fixture.state.invalidateIfCurrent.mockRejectedValueOnce(new Error("cleanup unavailable"));

    await expect(fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id)).resolves.toMatchObject({
      success: true,
      appointmentId: "appointment-1",
    });
    expect(fixture.booking.book).toHaveBeenCalledOnce();
  });

  it("keeps a reconciled booking success when best-effort state cleanup throws", async () => {
    const existing = appointment({ id: "existing-appointment" });
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    fixture.appointments.findByPeriod.mockResolvedValue([existing]);
    fixture.state.invalidateIfCurrent.mockRejectedValueOnce(new Error("cleanup unavailable"));

    await expect(fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id)).resolves.toMatchObject({
      success: true,
      appointmentId: existing.id,
    });
    expect(fixture.booking.book).not.toHaveBeenCalled();
  });

  it("does not write when the offer was replaced", async () => {
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    fixture.setCurrentState({ ...fixture.getCurrentState()!, id: "new-offer" });

    await expect(fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id)).resolves.toMatchObject({
      success: false,
      reason: "stale_offer",
    });
    expect(fixture.booking.book).not.toHaveBeenCalled();
  });

  it("does not let a different treatment inherit a persisted offer after catalog replacement", async () => {
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    const pendingStepId = fixture.getCurrentState()!.id;
    fixture.treatments.listByClinic.mockResolvedValue([
      treatment({ id: "replacement-treatment", name: "Clareamento" }),
    ]);

    await expect(fixture.adapters.schedulingRead.resolveOfferedSlot({
      pendingStepId,
      ordinal: 1,
      date: null,
      time: null,
    })).resolves.toBeNull();
    await expect(fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id)).resolves.toMatchObject({
      success: false,
      reason: "stale_offer",
    });
    expect(fixture.booking.book).not.toHaveBeenCalled();
  });

  it("rejects persisted slots with invalid chronology or a duration different from the treatment", async () => {
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    const current = fixture.getCurrentState()!;
    const payload = current.payload as { slots: FormattedSlot[] };
    fixture.setCurrentState({
      ...current,
      payload: {
        ...current.payload,
        slots: [{
          ...payload.slots[0]!,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000).toISOString(),
        }],
      },
    });

    await expect(fixture.adapters.schedulingRead.resolveOfferedSlot({
      pendingStepId: current.id,
      ordinal: 1,
      date: null,
      time: null,
    })).resolves.toBeNull();
    await expect(fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id)).resolves.toMatchObject({
      success: false,
      reason: "stale_offer",
    });
    expect(fixture.booking.book).not.toHaveBeenCalled();
  });

  it("does not accept trailing time text and resolves relative dates against the current turn", async () => {
    const fixture = setup();
    await offerOneSlot(fixture);
    const current = fixture.getCurrentState()!;
    fixture.setCurrentState({ ...current, createdAt: new Date("2026-08-01T12:00:00.000Z") });

    await expect(fixture.adapters.schedulingRead.resolveOfferedSlot({
      pendingStepId: current.id,
      ordinal: null,
      date: null,
      time: "15h lixo",
    })).resolves.toBeNull();
    await expect(fixture.adapters.schedulingRead.resolveOfferedSlot({
      pendingStepId: current.id,
      ordinal: null,
      date: "amanhã",
      time: "15h",
    })).resolves.toMatchObject({ label: "Ter 18/08 às 15h" });
  });

  it("reconciles a slot_taken race only when the new appointment is exact and belongs to the same lead", async () => {
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    const createdByCompetingAttempt = appointment({ id: "raced-appointment" });
    fixture.appointments.findByPeriod.mockClear();
    fixture.appointments.findByPeriod
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdByCompetingAttempt]);
    fixture.booking.book.mockResolvedValue({ success: false, reason: "slot_taken" });

    await expect(fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id)).resolves.toMatchObject({
      success: true,
      appointmentId: createdByCompetingAttempt.id,
    });
    expect(fixture.booking.book).toHaveBeenCalledOnce();
    expect(fixture.appointments.findByPeriod).toHaveBeenCalledTimes(2);
  });

  it("does not invalidate a newer state after booking consumes an older offer", async () => {
    const fixture = setup();
    const offered = await offerOneSlot(fixture);
    const consumedStateId = fixture.getCurrentState()!.id;
    const newerState: ConversationStateRow = {
      id: "newer-state",
      conversationId: conversation.id,
      state: "menu_offered",
      payload: null,
      supersedesStateId: null,
      createdAt: new Date(now.getTime() + 1_000),
      expiresAt: null,
    };
    fixture.booking.book.mockImplementation(async () => {
      fixture.setCurrentState(newerState);
      return { success: true, appointment: appointment() };
    });

    await expect(fixture.adapters.schedulingWrite.bookSlot(offered.slots[0]!.id)).resolves.toMatchObject({
      success: true,
    });
    expect(fixture.state.invalidateIfCurrent).toHaveBeenCalledWith(
      conversation.id,
      consumedStateId,
    );
    expect(fixture.getCurrentState()).toEqual(newerState);
  });
});

describe("Dental live adapters — appointment confirmation", () => {
  it("resolves and confirms only the tenant-and-lead appointment in the exact pending state", async () => {
    const pending = appointment({ id: "pending-appointment" });
    const fixture = setup({ appointmentById: pending });
    fixture.setCurrentState({
      id: "confirmation-state",
      conversationId: "conversation-lab",
      state: "awaiting_appointment_confirmation",
      payload: { appointmentId: pending.id, appointmentLabel: "Ter 18/08 às 15h" },
      supersedesStateId: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    await expect(fixture.adapters.schedulingRead.resolvePendingAppointment("confirmation-state")).resolves.toMatchObject({
      id: pending.id,
      label: "Ter 18/08 às 15h",
    });
    await expect(fixture.adapters.schedulingWrite.confirmAppointment(pending.id)).resolves.toMatchObject({
      success: true,
      appointmentId: pending.id,
    });
    expect(fixture.booking.confirmAppointment).toHaveBeenCalledWith({
      clinic,
      lead,
      appointmentId: pending.id,
    });
    expect(fixture.state.invalidateIfCurrent).toHaveBeenCalledWith(
      "conversation-lab",
      "confirmation-state",
    );
  });

  it("keeps an authoritative confirmation success when best-effort state cleanup throws", async () => {
    const pending = appointment({ id: "pending-appointment" });
    const fixture = setup({ appointmentById: pending });
    fixture.setCurrentState({
      id: "confirmation-state",
      conversationId: conversation.id,
      state: "awaiting_appointment_confirmation",
      payload: { appointmentId: pending.id, appointmentLabel: "Ter 18/08 às 15h" },
      supersedesStateId: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    fixture.state.invalidateIfCurrent.mockRejectedValueOnce(new Error("cleanup unavailable"));

    await expect(fixture.adapters.schedulingWrite.confirmAppointment(pending.id)).resolves.toMatchObject({
      success: true,
      appointmentId: pending.id,
    });
    expect(fixture.booking.confirmAppointment).toHaveBeenCalledOnce();
  });

  it("uses only the tenant-and-lead-scoped appointment read", async () => {
    const pending = appointment({ id: "pending-appointment" });
    const fixture = setup({ appointmentById: pending });
    fixture.appointments.findById.mockRejectedValue(new Error("global appointment read forbidden"));
    fixture.setCurrentState({
      id: "confirmation-state",
      conversationId: "conversation-lab",
      state: "awaiting_appointment_confirmation",
      payload: { appointmentId: pending.id, appointmentLabel: "Ter 18/08 às 15h" },
      supersedesStateId: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    await expect(fixture.adapters.schedulingRead.resolvePendingAppointment("confirmation-state")).resolves.toMatchObject({
      id: pending.id,
    });
    expect(fixture.appointments.findById).not.toHaveBeenCalled();
    expect(fixture.appointments.findByIdForClinicAndLead).toHaveBeenCalledWith(
      clinic.id,
      lead.id,
      pending.id,
    );
  });

  it("fails closed for a cross-tenant pending appointment", async () => {
    const foreign = appointment({ clinicId: "other-clinic" });
    const fixture = setup({ appointmentById: foreign });
    fixture.setCurrentState({
      id: "confirmation-state",
      conversationId: "conversation-lab",
      state: "awaiting_appointment_confirmation",
      payload: { appointmentId: foreign.id, appointmentLabel: "Ter 18/08 às 15h" },
      supersedesStateId: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });

    await expect(fixture.adapters.schedulingRead.resolvePendingAppointment("confirmation-state")).resolves.toBeNull();
    await expect(fixture.adapters.schedulingWrite.confirmAppointment(foreign.id)).resolves.toMatchObject({
      success: false,
      reason: "appointment_not_found",
    });
    expect(fixture.booking.confirmAppointment).not.toHaveBeenCalled();
  });
});
