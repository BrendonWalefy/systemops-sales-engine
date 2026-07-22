import type { Appointment } from "../entities/calendar-slot";

export type AppointmentRepository = {
  save(appointment: Appointment): Promise<void>;
  findById(id: string): Promise<Appointment | null>;
  findByLeadId(leadId: string): Promise<Appointment | null>;
  findActiveByLeadId(leadId: string): Promise<Appointment | null>;
  findAllActiveByLeadId(leadId: string): Promise<Appointment[]>;
  /**
   * Consultas que já aconteceram (mais recente primeiro), excluindo canceladas.
   * É o sinal de "paciente da casa" — deliberadamente NÃO exige status
   * `completed`: só 1 em 20 consultas encerradas chega a esse estado hoje
   * (#20 do plano de correção), então filtrar por ele zeraria o sinal.
   */
  findPastByLeadId(leadId: string, now?: Date): Promise<Appointment[]>;
  findByPeriod(clinicId: string, from: Date, to: Date): Promise<Appointment[]>;
  findDueReminders(params: { clinicId: string; windowStart: Date; windowEnd: Date }): Promise<Appointment[]>;
  findByCalendarEventId(clinicId: string, calendarEventId: string): Promise<Appointment | null>;
};
