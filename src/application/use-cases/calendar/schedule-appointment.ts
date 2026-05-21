import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import type { AppointmentRepository } from "@/domain/repositories/appointment-repository";
import type { LeadRepository } from "@/domain/repositories/lead-repository";

export type ScheduleAppointmentDependencies = {
  calendarGateway: CalendarGateway;
  appointmentRepository: AppointmentRepository;
  leadRepository: LeadRepository;
  now: () => Date;
};

export class ScheduleAppointment {
  constructor(private readonly deps: ScheduleAppointmentDependencies) {}

  async execute(input: {
    clinicId: string;
    leadId: string;
    startsAt: Date;
    endsAt: Date;
    title: string;
  }) {
    const lead = await this.deps.leadRepository.findById(input.leadId);
    if (!lead) {
      throw new Error("Lead not found");
    }

    const appointment = await this.deps.calendarGateway.createAppointment(input);
    await this.deps.appointmentRepository.save(appointment);
    await this.deps.leadRepository.save({
      ...lead,
      status: "appointment_scheduled",
      updatedAt: this.deps.now(),
    });

    return appointment;
  }
}

