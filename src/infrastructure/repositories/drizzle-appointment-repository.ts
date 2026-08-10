import { and, desc, eq, gt, gte, inArray, isNull, lt, lte, ne } from "drizzle-orm";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import { calendarEventIdCandidates } from "@/application/calendar/import-calendar-events";
import { db } from "@/infrastructure/db/client";
import { appointments } from "@/infrastructure/db/schema";
import { bumpInboxVersion } from "@/application/read-versions/clinic-read-version";

export class DrizzleAppointmentRepository implements AppointmentRepository {
  async save(appointment: Appointment): Promise<void> {
    await db
      .insert(appointments)
      .values({
        id: appointment.id,
        clinicId: appointment.clinicId,
        leadId: appointment.leadId,
        professionalId: appointment.professionalId,
        roomId: appointment.roomId,
        calendarEventId: appointment.calendarEventId,
        calendarEventUrl: appointment.calendarEventUrl,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status,
        source: appointment.source,
        // Fora do onConflictDoUpdate de propósito: a origem é imutável — quem
        // criou o agendamento não muda quando o status é atualizado depois.
        origin: appointment.origin,
        treatmentId: appointment.treatmentId,
        valueCents: appointment.valueCents,
        description: appointment.description,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
      })
      .onConflictDoUpdate({
        target: appointments.id,
        set: {
          professionalId: appointment.professionalId,
          roomId: appointment.roomId,
          calendarEventId: appointment.calendarEventId,
          calendarEventUrl: appointment.calendarEventUrl,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          status: appointment.status,
          reminderSentAt: appointment.reminderSentAt,
          treatmentId: appointment.treatmentId,
          valueCents: appointment.valueCents,
          description: appointment.description,
          updatedAt: appointment.updatedAt,
        },
      });
    bumpInboxVersion(appointment.clinicId);
  }

  async findById(id: string): Promise<Appointment | null> {
    const row = await db.query.appointments.findFirst({
      where: eq(appointments.id, id),
    });
    return row ? mapRow(row) : null;
  }

  async findByLeadId(leadId: string): Promise<Appointment | null> {
    const row = await db.query.appointments.findFirst({
      where: eq(appointments.leadId, leadId),
      orderBy: (a, { desc }) => [desc(a.createdAt)],
    });
    return row ? mapRow(row) : null;
  }

  async findActiveByLeadId(leadId: string): Promise<Appointment | null> {
    const row = await db.query.appointments.findFirst({
      where: and(
        eq(appointments.leadId, leadId),
        inArray(appointments.status, ["scheduled", "confirmed"]),
      ),
      orderBy: [desc(appointments.startsAt)],
    });
    return row ? mapRow(row) : null;
  }

  async findAllActiveByLeadId(leadId: string): Promise<Appointment[]> {
    const rows = await db.query.appointments.findMany({
      where: and(
        eq(appointments.leadId, leadId),
        inArray(appointments.status, ["scheduled", "confirmed"]),
      ),
      orderBy: [desc(appointments.startsAt)],
    });
    return rows.map(mapRow);
  }

  async findPastByLeadId(leadId: string, now: Date = new Date()): Promise<Appointment[]> {
    const rows = await db.query.appointments.findMany({
      where: and(
        eq(appointments.leadId, leadId),
        lt(appointments.startsAt, now),
        ne(appointments.status, "cancelled"),
      ),
      orderBy: [desc(appointments.startsAt)],
    });
    return rows.map(mapRow);
  }

  async findByCalendarEventId(clinicId: string, calendarEventId: string): Promise<Appointment | null> {
    const row = await db.query.appointments.findFirst({
      where: and(
        eq(appointments.clinicId, clinicId),
        inArray(appointments.calendarEventId, calendarEventIdCandidates(calendarEventId)),
      ),
    });
    return row ? mapRow(row) : null;
  }

  async findByPeriod(clinicId: string, from: Date, to: Date): Promise<Appointment[]> {
    const rows = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clinicId, clinicId),
        lt(appointments.startsAt, to),
        gt(appointments.endsAt, from),
      ),
      orderBy: [appointments.startsAt],
    });
    return rows.map(mapRow);
  }

  async findDueReminders(params: {
    clinicId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Appointment[]> {
    const rows = await db.query.appointments.findMany({
      where: and(
        eq(appointments.clinicId, params.clinicId),
        inArray(appointments.status, ["scheduled", "confirmed"]),
        isNull(appointments.reminderSentAt),
        gte(appointments.startsAt, params.windowStart),
        lte(appointments.startsAt, params.windowEnd),
      ),
    });
    return rows.map(mapRow);
  }
}

function mapRow(row: typeof appointments.$inferSelect): Appointment {
  return {
    id: row.id,
    clinicId: row.clinicId,
    leadId: row.leadId,
    professionalId: row.professionalId ?? null,
    roomId: row.roomId ?? null,
    calendarEventId: row.calendarEventId,
    calendarEventUrl: row.calendarEventUrl,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    source: row.source,
    origin: row.origin ?? null,
    reminderSentAt: row.reminderSentAt ?? null,
    treatmentId: row.treatmentId ?? null,
    valueCents: row.valueCents ?? null,
    description: row.description ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
