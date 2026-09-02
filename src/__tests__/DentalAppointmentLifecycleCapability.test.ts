import { describe, expect, it, vi } from "vitest";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import { createDentalAppointmentLifecycleCapability } from "@/domain-packs/dental/appointment-lifecycle-capability";
import type { DentalPolicy } from "@/domain-packs/dental/capabilities";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

const policy: DentalPolicy = {
  priceDisclosureEnabled: true,
  humanEscalationRequired: false,
  schedulingMinimumLeadTimeHours: 2,
  schedulingRequiresEvaluationFirst: false,
};
const state = { phase: "active", pendingStepId: null, completedStepIds: [] };
const context = { state, policy, now: new Date("2026-09-01T12:00:00.000Z") };

function understanding(
  request: DentalRequest,
  entities: Record<string, string | number | null> = {},
): Understanding<DentalRequest> {
  return {
    version: UNDERSTANDING_VERSION,
    request,
    dialogueMove: "new_topic",
    entities,
    signals: {},
    safety: {},
    confidence: 0.95,
    ambiguity: null,
  };
}

const firstAppointment = {
  id: "appointment-1",
  label: "quarta às 15h",
  evidenceRef: "appointment:appointment-1",
};
const secondAppointment = {
  id: "appointment-2",
  label: "sexta às 10h",
  evidenceRef: "appointment:appointment-2",
};

function ports(overrides: Record<string, unknown> = {}) {
  return {
    read: {
      listActiveAppointments: vi.fn().mockResolvedValue([]),
      resolveActiveAppointment: vi.fn().mockResolvedValue({ kind: "missing" }),
      listReplacementSlots: vi.fn().mockResolvedValue({
        service: { id: "service-1", name: "Consulta" },
        slots: [],
        replacesAppointmentId: firstAppointment.id,
      }),
      ...overrides.read as object,
    },
    write: {
      persistReplacementOffer: vi.fn(async (offer) => offer),
      cancelAppointment: vi.fn(),
      ...overrides.write as object,
    },
  };
}

describe("Dental appointment lifecycle capability", () => {
  it("lists zero, one and multiple active appointments as typed read outcomes", async () => {
    for (const appointments of [[], [firstAppointment], [firstAppointment, secondAppointment]]) {
      const dependencies = ports({
        read: { listActiveAppointments: vi.fn().mockResolvedValue(appointments) },
      });
      const capability = createDentalAppointmentLifecycleCapability(
        dependencies.read,
        dependencies.write,
      );
      const claim = capability.claim(understanding("list-appointments"), state)!;
      const result = await capability.execute(
        await capability.decide(claim, context),
        context,
      );

      expect(result.type).toBe(
        appointments.length === 0 ? "no_active_appointment" : "appointments_listed",
      );
      if (appointments.length > 0) {
        expect(result.semanticClass === "options_found" && result.options.map(({ id }) => id))
          .toEqual(appointments.map(({ id }) => id));
      }
    }
  });

  it("requires an exact appointment before cancellation and never broad-cancels", async () => {
    const cancelAppointment = vi.fn().mockResolvedValue({
      success: true,
      kind: "appointment",
      appointmentId: firstAppointment.id,
      label: firstAppointment.label,
      evidenceRef: "cancel:appointment-1",
    });
    const dependencies = ports({
      read: {
        resolveActiveAppointment: vi.fn()
          .mockResolvedValueOnce({
            kind: "ambiguous",
            appointments: [firstAppointment, secondAppointment],
          })
          .mockResolvedValueOnce({ kind: "resolved", appointment: firstAppointment }),
      },
      write: { cancelAppointment },
    });
    const capability = createDentalAppointmentLifecycleCapability(
      dependencies.read,
      dependencies.write,
    );

    const ambiguousClaim = capability.claim(understanding("cancel-appointment"), state)!;
    const ambiguous = await capability.execute(
      await capability.decide(ambiguousClaim, context),
      context,
    );
    expect(ambiguous.type).toBe("appointment_selection_required");
    expect(cancelAppointment).not.toHaveBeenCalled();

    const exactClaim = capability.claim(
      understanding("cancel-appointment", { ordinal: 1 }),
      state,
    )!;
    const exact = await capability.execute(
      await capability.decide(exactClaim, context),
      context,
    );
    expect(cancelAppointment).toHaveBeenCalledOnce();
    expect(cancelAppointment).toHaveBeenCalledWith(firstAppointment.id);
    expect(exact.type).toBe("appointment_cancelled");
  });

  it("offers replacement slots without mutating the current appointment", async () => {
    const replacementOffer = {
      service: { id: "service-1", name: "Consulta" },
      replacesAppointmentId: firstAppointment.id,
      slots: [{ id: "replacement-1", label: "segunda às 14h", evidenceRef: "slot:1" }],
    };
    const dependencies = ports({
      read: {
        resolveActiveAppointment: vi.fn().mockResolvedValue({
          kind: "resolved",
          appointment: firstAppointment,
        }),
        listReplacementSlots: vi.fn().mockResolvedValue(replacementOffer),
      },
    });
    const capability = createDentalAppointmentLifecycleCapability(
      dependencies.read,
      dependencies.write,
    );
    const claim = capability.claim(understanding("reschedule-appointment", {
      date: "segunda",
      period: "afternoon",
      professional: "Dra. Marina",
    }), state)!;
    const decision = await capability.decide(claim, context);

    expect(dependencies.write.persistReplacementOffer).not.toHaveBeenCalled();
    const result = await capability.execute(decision, context);
    expect(dependencies.write.cancelAppointment).not.toHaveBeenCalled();
    expect(dependencies.write.persistReplacementOffer).toHaveBeenCalledWith(replacementOffer);
    expect(result.type).toBe("appointment_reschedule_offered");
  });
});
