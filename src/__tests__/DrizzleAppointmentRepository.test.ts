import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Appointment } from "@/domain/entities/calendar-slot";

const dbMock = vi.hoisted(() => ({
  query: { appointments: { findFirst: vi.fn() } },
  update: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));
const bumpInboxVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/read-versions/clinic-read-version", () => ({
  bumpInboxVersion: bumpInboxVersionMock,
}));

import { DrizzleAppointmentRepository } from "@/infrastructure/repositories/drizzle-appointment-repository";

const now = new Date("2026-08-17T12:00:00.000Z");
const row: Appointment = {
  id: "appointment-1",
  clinicId: "clinic-1",
  leadId: "lead-1",
  professionalId: null,
  roomId: null,
  calendarEventId: null,
  calendarEventUrl: null,
  startsAt: new Date("2026-08-18T18:00:00.000Z"),
  endsAt: new Date("2026-08-18T19:00:00.000Z"),
  status: "scheduled",
  source: "app",
  origin: "ai_conversation",
  reminderSentAt: null,
  treatmentId: null,
  valueCents: null,
  description: null,
  createdAt: now,
  updatedAt: now,
};

function updateChain(rows: Appointment[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(rows),
  };
}

describe("DrizzleAppointmentRepository scoped confirmation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads an appointment through the exact clinic-and-lead signature", async () => {
    dbMock.query.appointments.findFirst.mockResolvedValue(row);
    await expect(new DrizzleAppointmentRepository().findByIdForClinicAndLead(
      row.clinicId,
      row.leadId,
      row.id,
    )).resolves.toEqual(row);
    expect(dbMock.query.appointments.findFirst).toHaveBeenCalledOnce();
  });

  it("returns the row only when scheduled-to-confirmed CAS updates it", async () => {
    const confirmed = { ...row, status: "confirmed" as const, updatedAt: now };
    dbMock.update.mockReturnValue(updateChain([confirmed]));
    await expect(new DrizzleAppointmentRepository().confirmScheduledForClinicAndLead(
      row.clinicId,
      row.leadId,
      row.id,
      now,
    )).resolves.toEqual(confirmed);
    expect(bumpInboxVersionMock).toHaveBeenCalledWith(row.clinicId);
  });

  it("returns null and does not bump Inbox when the scheduled CAS loses", async () => {
    dbMock.update.mockReturnValue(updateChain([]));
    await expect(new DrizzleAppointmentRepository().confirmScheduledForClinicAndLead(
      row.clinicId,
      row.leadId,
      row.id,
      now,
    )).resolves.toBeNull();
    expect(bumpInboxVersionMock).not.toHaveBeenCalled();
  });
});
