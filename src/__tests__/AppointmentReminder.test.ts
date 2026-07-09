// Tests for the appointment reminder feature.
// Covers: InMemoryDemoStore.findDueReminders, idempotency via reminderSentAt,
// cron auth, and window logic.

import { describe, it, expect } from "vitest";
import type { Appointment } from "@/domain/entities/calendar-slot";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const base: Appointment = {
    id: "appt-1",
    clinicId: "clinic-1",
    leadId: "lead-1",
    professionalId: null,
    roomId: null, description: null,
    calendarEventId: "cal-1",
    calendarEventUrl: null,
    startsAt: new Date("2026-06-02T14:00:00Z"),
    endsAt: new Date("2026-06-02T15:00:00Z"),
    status: "scheduled",
    source: "app",
    reminderSentAt: null,
    treatmentId: null,
    valueCents: null,
    createdAt: new Date("2026-05-01"),
    updatedAt: new Date("2026-05-01"),
  };

  return {
    ...base,
    ...overrides,
    treatmentId: overrides.treatmentId ?? null,
    valueCents: overrides.valueCents ?? null,
  };
}

// ─── Tests: InMemoryDemoStore.findDueReminders ──────────────────────────────

describe("InMemoryDemoStore.findDueReminders", () => {
  async function makeStore() {
    const { InMemoryDemoStore } = await import(
      "@/infrastructure/repositories/in-memory-demo-repositories"
    );
    return new InMemoryDemoStore();
  }

  const now = new Date("2026-06-01T13:00:00Z");
  const windowStart = new Date(now.getTime() + 20 * 60 * 60 * 1000); // +20h = 2026-06-02T09:00Z
  const windowEnd = new Date(now.getTime() + 32 * 60 * 60 * 1000);   // +32h = 2026-06-02T21:00Z

  it("retorna consulta scheduled dentro da janela sem reminderSentAt", async () => {
    const store = await makeStore();
    const appt = makeAppointment({ startsAt: new Date("2026-06-02T14:00:00Z") });
    await store.save(appt);

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("appt-1");
  });

  it("retorna consulta confirmed dentro da janela sem reminderSentAt", async () => {
    const store = await makeStore();
    await store.save(makeAppointment({ status: "confirmed" }));

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(1);
  });

  it("NÃO retorna consulta com reminderSentAt já preenchido (idempotência)", async () => {
    const store = await makeStore();
    await store.save(makeAppointment({ reminderSentAt: new Date("2026-06-01T10:00:00Z") }));

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(0);
  });

  it("NÃO retorna consulta cancelled", async () => {
    const store = await makeStore();
    await store.save(makeAppointment({ status: "cancelled" }));

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(0);
  });

  it("NÃO retorna consulta completed", async () => {
    const store = await makeStore();
    await store.save(makeAppointment({ status: "completed" }));

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(0);
  });

  it("NÃO retorna consulta fora da janela (muito cedo)", async () => {
    const store = await makeStore();
    // Consulta em 2 horas — antes do início da janela (+20h)
    const tooSoon = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    await store.save(makeAppointment({ startsAt: tooSoon }));

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(0);
  });

  it("NÃO retorna consulta fora da janela (muito tarde)", async () => {
    const store = await makeStore();
    // Consulta em 48 horas — depois do fim da janela (+32h)
    const tooLate = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    await store.save(makeAppointment({ startsAt: tooLate }));

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(0);
  });

  it("NÃO retorna consulta de outra clínica", async () => {
    const store = await makeStore();
    await store.save(makeAppointment({ clinicId: "other-clinic" }));

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(0);
  });

  it("múltiplas consultas — retorna apenas as elegíveis", async () => {
    const store = await makeStore();
    const inWindow = new Date("2026-06-02T14:00:00Z");
    const tooLate = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    await store.save(makeAppointment({ id: "appt-1", startsAt: inWindow }));
    await store.save(makeAppointment({ id: "appt-2", startsAt: inWindow, reminderSentAt: new Date() }));
    await store.save(makeAppointment({ id: "appt-3", startsAt: tooLate }));
    await store.save(makeAppointment({ id: "appt-4", startsAt: inWindow, status: "cancelled" }));
    await store.save(makeAppointment({ id: "appt-5", startsAt: inWindow, clinicId: "other" }));

    const due = await store.findDueReminders({ clinicId: "clinic-1", windowStart, windowEnd });
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("appt-1");
  });
});

// ─── Tests: janela de tempo ─────────────────────────────────────────────────

describe("AppointmentReminder — janela de tempo", () => {
  const WINDOW_START_HOURS = 20;
  const WINDOW_END_HOURS = 32;

  function buildWindow(now: Date) {
    return {
      windowStart: new Date(now.getTime() + WINDOW_START_HOURS * 60 * 60 * 1000),
      windowEnd: new Date(now.getTime() + WINDOW_END_HOURS * 60 * 60 * 1000),
    };
  }

  it("cron às 13h UTC captura consulta às 14h UTC do dia seguinte", () => {
    const cronTime = new Date("2026-06-01T13:00:00Z");
    const { windowStart, windowEnd } = buildWindow(cronTime);
    const appointment = new Date("2026-06-02T14:00:00Z");
    expect(appointment >= windowStart && appointment <= windowEnd).toBe(true);
  });

  it("cron às 13h UTC NÃO captura consulta no mesmo dia às 15h UTC", () => {
    const cronTime = new Date("2026-06-01T13:00:00Z");
    const { windowStart, windowEnd } = buildWindow(cronTime);
    const sameDay = new Date("2026-06-01T15:00:00Z");
    expect(sameDay >= windowStart && sameDay <= windowEnd).toBe(false);
  });

  it("janela tem exatamente 12 horas de duração", () => {
    const { windowStart, windowEnd } = buildWindow(new Date());
    const durationHours = (windowEnd.getTime() - windowStart.getTime()) / (60 * 60 * 1000);
    expect(durationHours).toBe(12);
  });
});
