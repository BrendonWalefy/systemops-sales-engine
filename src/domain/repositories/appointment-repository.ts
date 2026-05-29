import type { Appointment } from "../entities/calendar-slot";

export type AppointmentRepository = {
  save(appointment: Appointment): Promise<void>;
  findByLeadId(leadId: string): Promise<Appointment | null>;
  findActiveByLeadId(leadId: string): Promise<Appointment | null>;
  findAllActiveByLeadId(leadId: string): Promise<Appointment[]>;
  findDueReminders(params: { clinicId: string; windowStart: Date; windowEnd: Date }): Promise<Appointment[]>;
};
