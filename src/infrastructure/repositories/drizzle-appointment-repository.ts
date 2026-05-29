import { and, desc, eq, inArray, isNull, gte, lte } from "drizzle-orm";
import type { Appointment } from "@/domain/entities/calendar-slot";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import { db } from "@/infrastructure/db/client";
import { appointments } from "@/infrastructure/db/schema";

export class DrizzleAppointmentRepository implements AppointmentRepository {
  async save(appointment: Appointment): Promise<void> {
    await db
      .insert(appointments)
      .values({
        id: appointment.id,
        clinicId: appointment.clinicId,
        leadId: appointment.leadId,
        calendarEventId: appointment.calendarEventId,
        calendarEventUrl: appointment.calendarEventUrl,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
      })
      .onConflictDoUpdate({
        target: appointments.id,
        set: {
          calendarEventId: appointment.calendarEventId,
          calendarEventUrl: appointment.calendarEventUrl,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          status: appointment.status,
          reminderSentAt: appointment.reminderSentAt,
          updatedAt: appointment.updatedAt,
        },
      });
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
    calendarEventId: row.calendarEventId,
    calendarEventUrl: row.calendarEventUrl,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    reminderSentAt: row.reminderSentAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
