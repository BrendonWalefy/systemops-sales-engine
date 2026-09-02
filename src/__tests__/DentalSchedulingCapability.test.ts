import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import {
  createDentalSchedulingCapability,
  type DentalOutcomeType,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const policy: DentalPolicy = { priceDisclosureEnabled: true, humanEscalationRequired: false, schedulingMinimumLeadTimeHours: 2, schedulingRequiresEvaluationFirst: false };
const understanding = (request: DentalRequest, entities: Record<string, string | number> = {}): Understanding<DentalRequest> => ({
  version: UNDERSTANDING_VERSION, request, dialogueMove: request.startsWith("confirm") ? "answers_pending" : "new_topic",
  entities, signals: {}, safety: {}, confidence: 0.9, ambiguity: null,
});

describe("Dental Scheduling capability", () => {
  it("preserva o outcome concreto como união tipada do Domain Pack", () => {
    type ExecuteResult = Awaited<ReturnType<
      ReturnType<typeof createDentalSchedulingCapability>["execute"]
    >>;

    expectTypeOf<ExecuteResult["type"]>().toEqualTypeOf<DentalOutcomeType>();
    expectTypeOf<ExecuteResult["type"]>().not.toEqualTypeOf<string>();
  });

  it("pedido de agendamento lê no decide e persiste a oferta somente no execute", async () => {
    const listSlots = vi.fn().mockResolvedValue({
      service: { id: "svc-1", name: "Limpeza" },
      slots: [{ id: "slot-1", label: "quarta às 15h", evidenceRef: "calendar-snapshot-1" }],
    });
    const bookSlot = vi.fn();
    const persistSlotOffer = vi.fn(async (offer) => offer);
    const capability = createDentalSchedulingCapability(
      { listSlots, resolveOfferedSlot: vi.fn(), resolvePendingAppointment: vi.fn() },
      { persistSlotOffer, bookSlot, confirmAppointment: vi.fn(), rescheduleSlot: vi.fn() },
    );
    const state = { phase: "active", pendingStepId: null, completedStepIds: [] };
    const claim = capability.claim(understanding("book-appointment", { date: "quarta" }), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    expect(persistSlotOffer).not.toHaveBeenCalled();
    const result = await capability.execute(decision, { state, policy, now: new Date(0) });
    expect(listSlots).toHaveBeenCalledOnce();
    expect(persistSlotOffer).toHaveBeenCalledOnce();
    expect(bookSlot).not.toHaveBeenCalled();
    expect(result.type).toBe("slots_found");
    expect(result.semanticClass).toBe("options_found");
    expect(result.subject).toEqual({ type: "service", id: "svc-1", displayName: "Limpeza" });
    expect(result.semanticClass === "options_found" && result.options[0]?.facts[0]).toEqual(expect.objectContaining({ subject: { type: "slot", id: "slot-1", displayName: "quarta às 15h" }, disclosure: "allowed" }));
  });

  it("confirma slot resolvido e só afirma sucesso com evidence do write", async () => {
    const slot = { id: "slot-2", label: "quarta às 15h", evidenceRef: "offer-1" };
    const bookSlot = vi.fn().mockResolvedValue({ success: true, kind: "appointment", appointmentId: "appt-1", label: slot.label, evidenceRef: "booking-1" });
    const capability = createDentalSchedulingCapability(
      { listSlots: vi.fn(), resolveOfferedSlot: vi.fn().mockResolvedValue(slot), resolvePendingAppointment: vi.fn() },
      { persistSlotOffer: vi.fn(async (offer) => offer), bookSlot, confirmAppointment: vi.fn(), rescheduleSlot: vi.fn() },
    );
    const state = { phase: "awaiting_slot", pendingStepId: "offer-1", completedStepIds: [] };
    const claim = capability.claim(understanding("confirm-slot", { ordinal: 2 }), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    expect(bookSlot).not.toHaveBeenCalled();
    const result = await capability.execute(decision, { state, policy, now: new Date(0) });
    expect(bookSlot).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      type: "appointment_created", semanticClass: "effect_completed",
      subject: { type: "appointment", id: "appt-1", displayName: "quarta às 15h" }, facts: [expect.objectContaining({
      subject: { type: "appointment", id: "appt-1", displayName: "quarta às 15h" }, evidence: { source: "write", reference: "booking-1" },
    })] }));
  });

  it("represents a deposit hold as its own exact outcome, never as an appointment", async () => {
    const slot = { id: "slot-deposit", label: "quarta às 15h", evidenceRef: "offer-1" };
    const capability = createDentalSchedulingCapability(
      {
        listSlots: vi.fn(),
        resolveOfferedSlot: vi.fn().mockResolvedValue(slot),
        resolvePendingAppointment: vi.fn(),
      },
      {
        persistSlotOffer: vi.fn(async (offer) => offer),
        bookSlot: vi.fn().mockResolvedValue({
          success: true,
          kind: "deposit_requested",
          reservationId: "reservation-1",
          label: slot.label,
          requestText: "Texto determinístico privado ao delivery plan.",
          evidenceRef: "deposit-state:1",
        }),
        confirmAppointment: vi.fn(),
        rescheduleSlot: vi.fn(),
      },
    );
    const state = { phase: "awaiting_slot", pendingStepId: "offer-1", completedStepIds: [] };
    const claim = capability.claim(understanding("confirm-slot", { ordinal: 1 }), state)!;

    await expect(capability.execute(
      await capability.decide(claim, { state, policy, now: new Date(0) }),
      { state, policy, now: new Date(0) },
    )).resolves.toMatchObject({
      type: "deposit_requested",
      semanticClass: "effect_completed",
      subject: {
        type: "deposit",
        id: "reservation-1",
        displayName: slot.label,
      },
      facts: [expect.objectContaining({ key: "deposit_slot_label" })],
    });
  });

  it("routes a persisted replacement slot to the reschedule write boundary", async () => {
    const slot = {
      id: "replacement-slot-1",
      label: "sexta às 14h",
      evidenceRef: "replacement-offer-1",
      bookingKind: "reschedule" as const,
    };
    const rescheduleSlot = vi.fn().mockResolvedValue({
      success: true,
      kind: "appointment",
      appointmentId: "appointment-1",
      label: slot.label,
      evidenceRef: "reschedule:appointment-1",
    });
    const capability = createDentalSchedulingCapability(
      {
        listSlots: vi.fn(),
        resolveOfferedSlot: vi.fn().mockResolvedValue(slot),
        resolvePendingAppointment: vi.fn(),
      },
      {
        persistSlotOffer: vi.fn(async (offer) => offer),
        bookSlot: vi.fn(),
        confirmAppointment: vi.fn(),
        rescheduleSlot,
      },
    );
    const offered = { phase: "awaiting_slot", pendingStepId: "replacement-offer-1", completedStepIds: [] };
    const claim = capability.claim(understanding("confirm-slot", { ordinal: 1 }), offered)!;
    const decision = await capability.decide(claim, { state: offered, policy, now: new Date(0) });

    expect(decision).toMatchObject({ kind: "execute", action: { type: "reschedule-slot" } });
    await expect(capability.execute(decision, { state: offered, policy, now: new Date(0) }))
      .resolves.toMatchObject({ type: "appointment_rescheduled", semanticClass: "effect_completed" });
    expect(rescheduleSlot).toHaveBeenCalledWith(slot.id);
  });

  it("terminates a failed reschedule compensation as explicit human action", async () => {
    const slot = {
      id: "replacement-slot-1",
      label: "sexta às 14h",
      evidenceRef: "replacement-offer-1",
      bookingKind: "reschedule" as const,
    };
    const capability = createDentalSchedulingCapability(
      {
        listSlots: vi.fn(),
        resolveOfferedSlot: vi.fn().mockResolvedValue(slot),
        resolvePendingAppointment: vi.fn(),
      },
      {
        persistSlotOffer: vi.fn(async (offer) => offer),
        bookSlot: vi.fn(),
        confirmAppointment: vi.fn(),
        rescheduleSlot: vi.fn().mockResolvedValue({
          success: false,
          reason: "compensation_failed",
          evidenceRef: "reschedule:compensation_failed",
        }),
      },
    );
    const state = {
      phase: "awaiting_slot",
      pendingStepId: "replacement-offer-1",
      completedStepIds: [],
    };
    const claim = capability.claim(understanding("confirm-slot", { ordinal: 1 }), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });

    await expect(capability.execute(decision, { state, policy, now: new Date(0) }))
      .resolves.toMatchObject({
        type: "appointment_reschedule_compensation_failed",
        semanticClass: "human_action_required",
        evidence: [{ source: "write", reference: "reschedule:compensation_failed" }],
      });
  });

  it("sem pending state não lê nem escreve", async () => {
    const resolveOfferedSlot = vi.fn(); const bookSlot = vi.fn();
    const capability = createDentalSchedulingCapability(
      { listSlots: vi.fn(), resolveOfferedSlot, resolvePendingAppointment: vi.fn() },
      { persistSlotOffer: vi.fn(async (offer) => offer), bookSlot, confirmAppointment: vi.fn(), rescheduleSlot: vi.fn() },
    );
    const state = { phase: "active", pendingStepId: null, completedStepIds: [] };
    const claim = capability.claim(understanding("confirm-slot", { ordinal: 2 }), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    expect(decision.kind).toBe("ask");
    expect(resolveOfferedSlot).not.toHaveBeenCalled();
    expect((await capability.execute(decision, { state, policy, now: new Date(0) })).type).toBe("clarification_required");
    expect(bookSlot).not.toHaveBeenCalled();
  });

  it("write falho não produz fato de agendamento", async () => {
    const capability = createDentalSchedulingCapability(
      { listSlots: vi.fn(), resolveOfferedSlot: vi.fn().mockResolvedValue({ id: "slot-2", label: "quarta às 15h", evidenceRef: "offer-1" }), resolvePendingAppointment: vi.fn() },
      { persistSlotOffer: vi.fn(async (offer) => offer), bookSlot: vi.fn().mockResolvedValue({ success: false, reason: "slot_taken", evidenceRef: "booking-2" }), confirmAppointment: vi.fn(), rescheduleSlot: vi.fn() },
    );
    const state = { phase: "awaiting_slot", pendingStepId: "offer-1", completedStepIds: [] };
    const claim = capability.claim(understanding("confirm-slot", { ordinal: 2 }), state)!;
    const result = await capability.execute(await capability.decide(claim, { state, policy, now: new Date(0) }), { state, policy, now: new Date(0) });
    expect(result).toEqual(expect.objectContaining({
      type: "appointment_create_failed", semanticClass: "effect_failed", subject: null, facts: [],
    }));
  });

  it("confirma appointment pendente com evidence do write", async () => {
    const confirmAppointment = vi.fn().mockResolvedValue({ success: true, kind: "appointment", appointmentId: "appt-1", label: "hoje às 16:00", evidenceRef: "confirmation-1" });
    const capability = createDentalSchedulingCapability(
      { listSlots: vi.fn(), resolveOfferedSlot: vi.fn(), resolvePendingAppointment: vi.fn().mockResolvedValue({ id: "appt-1", label: "hoje às 16:00", evidenceRef: "pending-1" }) },
      { persistSlotOffer: vi.fn(async (offer) => offer), bookSlot: vi.fn(), confirmAppointment, rescheduleSlot: vi.fn() },
    );
    const state = { phase: "awaiting_appointment_confirmation", pendingStepId: "confirmation-1", completedStepIds: [] };
    const claim = capability.claim(understanding("confirm-appointment", { time: "16:00" }), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    expect(confirmAppointment).not.toHaveBeenCalled();
    const result = await capability.execute(decision, { state, policy, now: new Date(0) });
    expect(confirmAppointment).toHaveBeenCalledWith("appt-1");
    expect(result.type).toBe("appointment_confirmed");
    expect(result.facts[0]?.evidence).toEqual({ source: "write", reference: "confirmation-1" });
  });

  it("recusa action estrangeira sem chamar write port", async () => {
    const bookSlot = vi.fn(); const confirmAppointment = vi.fn();
    const capability = createDentalSchedulingCapability(
      { listSlots: vi.fn(), resolveOfferedSlot: vi.fn(), resolvePendingAppointment: vi.fn() },
      { persistSlotOffer: vi.fn(async (offer) => offer), bookSlot, confirmAppointment, rescheduleSlot: vi.fn() },
    );
    const state = { phase: "active", pendingStepId: null, completedStepIds: [] };
    const result = await capability.execute({
      kind: "execute", action: { type: "foreign-action", parameters: { appointmentId: "appt-1" } }, nextBestStep: null,
    }, { state, policy, now: new Date(0) });
    expect(result).toEqual(expect.objectContaining({
      type: "scheduling_failed", semanticClass: "effect_failed", facts: [],
    }));
    expect(bookSlot).not.toHaveBeenCalled();
    expect(confirmAppointment).not.toHaveBeenCalled();
  });
});
