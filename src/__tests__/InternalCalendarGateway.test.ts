// Testes do modo interno: conflito/overlap, bloqueio, timezone, buffer, filtro por
// profissional, pipeline de oferta de slots (o que a IA oferece) e o contrato de
// escrita do gateway (appointment interno sem evento externo, no-ops).

import { describe, expect, it } from "vitest";
import { ClinicTimezone, type ParsedBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { computeAvailableSlots } from "@/core/scheduling/SlotEngine";
import {
  buildBusyEvents,
  hasOverlap,
  type AppointmentLike,
  type BlockLike,
} from "@/core/scheduling/internal-availability";
import { InternalCalendarGateway } from "@/infrastructure/adapters/calendar/internal/internal-calendar-gateway";

const tz = new ClinicTimezone("America/Sao_Paulo");

const businessHours: ParsedBusinessHours = {
  startHour: 8,
  startMinute: 0,
  endHour: 18,
  endMinute: 0,
  days: [1, 2, 3, 4, 5],
};

function localDate(hour: number, minute = 0): Date {
  return tz.fromLocalParts(2026, 0, 5, hour, minute); // 2026-01-05 = segunda-feira
}

function appt(hour: number, endHour: number, professionalId: string | null = null): AppointmentLike {
  return { startsAt: localDate(hour), endsAt: localDate(endHour), professionalId };
}

function block(hour: number, endHour: number, professionalId: string | null = null): BlockLike {
  return { startsAt: localDate(hour), endsAt: localDate(endHour), professionalId };
}

function localTimeLabel(date: Date): string {
  const p = tz.toLocalParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

describe("internal-availability — buildBusyEvents", () => {
  it("marca consultas com buffer pós-evento e bloqueios sem buffer", () => {
    const busy = buildBusyEvents({ appointments: [appt(9, 10)], blocks: [block(12, 13)] });
    expect(busy).toHaveLength(2);
    expect(busy[0].appliesPostEventBuffer).toBe(true);
    expect(busy[1].appliesPostEventBuffer).toBe(false);
  });

  it("sem profissional informado, conta todos os eventos da clínica", () => {
    const busy = buildBusyEvents({
      appointments: [appt(9, 10, "prof-a"), appt(11, 12, "prof-b")],
      blocks: [],
    });
    expect(busy).toHaveLength(2);
  });

  it("com profissional, conta só os dele + bloqueios da clínica inteira (null)", () => {
    const busy = buildBusyEvents({
      appointments: [appt(9, 10, "prof-a"), appt(11, 12, "prof-b")],
      blocks: [block(14, 15, null), block(16, 17, "prof-b")],
      professionalId: "prof-a",
    });
    expect(busy).toHaveLength(2);
    expect(busy[0].startsAt).toEqual(localDate(9));
    expect(busy[1].startsAt).toEqual(localDate(14));
  });
});

describe("internal-availability — hasOverlap (conflito / double booking)", () => {
  const busy = [{ startsAt: localDate(9), endsAt: localDate(10) }];

  it("detecta sobreposição parcial", () => {
    expect(hasOverlap(busy, localDate(9, 30), localDate(10, 30))).toBe(true);
  });

  it("conflito exato no mesmo horário (double booking) é detectado", () => {
    expect(hasOverlap(busy, localDate(9), localDate(10))).toBe(true);
  });

  it("intervalos que apenas encostam NÃO conflitam", () => {
    expect(hasOverlap(busy, localDate(10), localDate(11))).toBe(false);
    expect(hasOverlap(busy, localDate(8), localDate(9))).toBe(false);
  });

  it("contenção (slot dentro de evento maior) é conflito", () => {
    expect(hasOverlap([{ startsAt: localDate(8), endsAt: localDate(18) }], localDate(10), localDate(11))).toBe(true);
  });

  it("sem sobreposição retorna false", () => {
    expect(hasOverlap(busy, localDate(14), localDate(15))).toBe(false);
  });
});

describe("internal-availability — pipeline de oferta (o que a IA oferece)", () => {
  it("remove da oferta horários ocupados por consultas e bloqueios", () => {
    const busy = buildBusyEvents({ appointments: [appt(9, 10)], blocks: [block(11, 12)] });
    const starts = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: busy,
      from: localDate(8),
      to: localDate(13),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
    }).map((s) => localTimeLabel(s.startsAt));
    expect(starts).toEqual(["08:00", "10:00", "12:00"]);
  });

  it("aplica buffer pós-consulta mas não após bloqueio", () => {
    const busy = buildBusyEvents({ appointments: [appt(9, 10)], blocks: [block(11, 12)] });
    const starts = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: busy,
      from: localDate(8),
      to: localDate(13),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
      postEventBufferMinutes: 60,
    }).map((s) => localTimeLabel(s.startsAt));
    expect(starts).toEqual(["08:00", "12:00"]);
  });

  it("respeita o fuso da clínica: evento dado em UTC remove o slot local correto", () => {
    // 12:00Z = 09:00 em America/Sao_Paulo (UTC-3). Deve remover o slot local das 09h.
    const busyUtc = [{ startsAt: new Date("2026-01-05T12:00:00.000Z"), endsAt: new Date("2026-01-05T13:00:00.000Z") }];
    const starts = computeAvailableSlots({
      timezone: tz,
      businessHours,
      existingEvents: busyUtc,
      from: localDate(8),
      to: localDate(11),
      slotDurationMinutes: 60,
      clinicId: "clinic-test",
    }).map((s) => localTimeLabel(s.startsAt));
    expect(starts).toEqual(["08:00", "10:00"]);
  });
});

describe("InternalCalendarGateway — contrato de escrita (sem evento externo)", () => {
  const gateway = new InternalCalendarGateway({ timezone: tz, businessHours: null });

  it("createAppointment cria appointment interno sem calendarEventId e source 'app'", async () => {
    const appointment = await gateway.createAppointment({
      clinicId: "clinic-1",
      leadId: "lead-1",
      startsAt: localDate(9),
      endsAt: localDate(10),
      title: "Consulta — Maria",
    });
    expect(appointment.calendarEventId).toBeNull();
    expect(appointment.source).toBe("app");
    expect(appointment.status).toBe("scheduled");
    expect(appointment.startsAt).toEqual(localDate(9));
  });

  it("cancelAppointment e updateCalendarEvent são no-ops que resolvem sem erro", async () => {
    await expect(gateway.cancelAppointment({ calendarEventId: "x" })).resolves.toBeUndefined();
    await expect(
      gateway.updateCalendarEvent({ calendarEventId: "x", startsAt: localDate(9), endsAt: localDate(10) }),
    ).resolves.toBeUndefined();
  });
});
