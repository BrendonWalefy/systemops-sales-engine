import type { Appointment } from "../entities/calendar-slot";

export type AppointmentRepository = {
  save(appointment: Appointment): Promise<void>;
  findByLeadId(leadId: string): Promise<Appointment | null>;
};

