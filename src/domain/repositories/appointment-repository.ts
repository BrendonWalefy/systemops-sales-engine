import type { Appointment } from "../entities/calendar-slot";

export type AppointmentRepository = {
  save(appointment: Appointment): Promise<void>;
  findById(id: string): Promise<Appointment | null>;
  findByLeadId(leadId: string): Promise<Appointment | null>;
  findActiveByLeadId(leadId: string): Promise<Appointment | null>;
  findAllActiveByLeadId(leadId: string): Promise<Appointment[]>;
  findByPeriod(clinicId: string, from: Date, to: Date): Promise<Appointment[]>;
  findDueReminders(params: { clinicId: string; windowStart: Date; windowEnd: Date }): Promise<Appointment[]>;
  findByCalendarEventId(clinicId: string, calendarEventId: string): Promise<Appointment | null>;
};
