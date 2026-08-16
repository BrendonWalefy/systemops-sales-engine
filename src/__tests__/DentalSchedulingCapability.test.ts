import { describe, expect, it, vi } from "vitest";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import { createDentalSchedulingCapability, type DentalPolicy } from "@/domain-packs/dental/capabilities";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const policy: DentalPolicy = { priceDisclosureEnabled: true, humanEscalationRequired: false, schedulingMinimumLeadTimeHours: 2, schedulingRequiresEvaluationFirst: false };
const understanding = (request: DentalRequest, entities: Record<string, string | number> = {}): Understanding<DentalRequest> => ({
  version: UNDERSTANDING_VERSION, request, dialogueMove: request.startsWith("confirm") ? "answers_pending" : "new_topic",
  entities, signals: {}, safety: {}, confidence: 0.9, ambiguity: null,
});

describe("Dental Scheduling capability", () => {
  it("pedido de agendamento lê e oferece slots sem write", async () => {
    const listSlots = vi.fn().mockResolvedValue([{ id: "slot-1", label: "quarta às 15h", evidenceRef: "calendar-snapshot-1" }]);
    const bookSlot = vi.fn();
    const capability = createDentalSchedulingCapability(
      { listSlots, resolveOfferedSlot: vi.fn(), resolvePendingAppointment: vi.fn() },
      { bookSlot, confirmAppointment: vi.fn() },
    );
    const state = { phase: "active", pendingStepId: null, completedStepIds: [] };
    const claim = capability.claim(understanding("book-appointment", { date: "quarta" }), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    const result = await capability.execute(decision, { state, policy, now: new Date(0) });
    expect(listSlots).toHaveBeenCalledOnce();
    expect(bookSlot).not.toHaveBeenCalled();
    expect(result.type).toBe("slots_found");
    expect(result.facts[0]).toEqual(expect.objectContaining({ subject: { type: "slot", id: "slot-1" }, disclosure: "allowed" }));
  });

  it("confirma slot resolvido e só afirma sucesso com evidence do write", async () => {
    const slot = { id: "slot-2", label: "quarta às 15h", evidenceRef: "offer-1" };
    const bookSlot = vi.fn().mockResolvedValue({ success: true, appointmentId: "appt-1", label: slot.label, evidenceRef: "booking-1" });
    const capability = createDentalSchedulingCapability(
      { listSlots: vi.fn(), resolveOfferedSlot: vi.fn().mockResolvedValue(slot), resolvePendingAppointment: vi.fn() },
      { bookSlot, confirmAppointment: vi.fn() },
    );
    const state = { phase: "awaiting_slot", pendingStepId: "offer-1", completedStepIds: [] };
    const claim = capability.claim(understanding("confirm-slot", { ordinal: 2 }), state)!;
    const decision = await capability.decide(claim, { state, policy, now: new Date(0) });
    expect(bookSlot).not.toHaveBeenCalled();
    const result = await capability.execute(decision, { state, policy, now: new Date(0) });
    expect(bookSlot).toHaveBeenCalledOnce();
    expect(result).toEqual({ type: "appointment_created", facts: [expect.objectContaining({
      subject: { type: "appointment", id: "appt-1" }, evidence: { source: "write", reference: "booking-1" },
    })] });
  });

  it("sem pending state não lê nem escreve", async () => {
    const resolveOfferedSlot = vi.fn(); const bookSlot = vi.fn();
    const capability = createDentalSchedulingCapability(
      { listSlots: vi.fn(), resolveOfferedSlot, resolvePendingAppointment: vi.fn() },
      { bookSlot, confirmAppointment: vi.fn() },
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
      { bookSlot: vi.fn().mockResolvedValue({ success: false, reason: "slot_taken", evidenceRef: "booking-2" }), confirmAppointment: vi.fn() },
    );
    const state = { phase: "awaiting_slot", pendingStepId: "offer-1", completedStepIds: [] };
    const claim = capability.claim(understanding("confirm-slot", { ordinal: 2 }), state)!;
    const result = await capability.execute(await capability.decide(claim, { state, policy, now: new Date(0) }), { state, policy, now: new Date(0) });
    expect(result).toEqual({ type: "appointment_create_failed", facts: [] });
  });

  it("confirma appointment pendente com evidence do write", async () => {
    const confirmAppointment = vi.fn().mockResolvedValue({ success: true, appointmentId: "appt-1", label: "hoje às 16:00", evidenceRef: "confirmation-1" });
    const capability = createDentalSchedulingCapability(
      { listSlots: vi.fn(), resolveOfferedSlot: vi.fn(), resolvePendingAppointment: vi.fn().mockResolvedValue({ id: "appt-1", label: "hoje às 16:00", evidenceRef: "pending-1" }) },
      { bookSlot: vi.fn(), confirmAppointment },
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
      { bookSlot, confirmAppointment },
    );
    const state = { phase: "active", pendingStepId: null, completedStepIds: [] };
    const result = await capability.execute({
      kind: "execute", action: { type: "foreign-action", parameters: { appointmentId: "appt-1" } }, nextBestStep: null,
    }, { state, policy, now: new Date(0) });
    expect(result).toEqual({ type: "scheduling_failed", facts: [] });
    expect(bookSlot).not.toHaveBeenCalled();
    expect(confirmAppointment).not.toHaveBeenCalled();
  });
});
