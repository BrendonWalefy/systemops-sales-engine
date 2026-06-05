import type { CalendarGateway } from "@/application/ports/calendar-gateway";

export type DbResetCounts = {
  conversationStates: number;
  messages: number;
  agentRecommendations: number;
  slotReservations: number;
  followUps: number;
  appointments: number;
  calendarBlocks: number;
  conversations: number;
  aiUsageCosts: number;
  whatsappMessageCosts: number;
  leads: number;
};

export type ResetCounts = DbResetCounts & { calendarEventsDeleted: number };

export type ClinicResetPort = {
  findClinicName(clinicId: string): Promise<string | null>;
  listAppointmentCalendarIds(clinicId: string): Promise<string[]>;
  deleteAllData(clinicId: string): Promise<DbResetCounts>;
};

export type ResetClinicDataDeps = {
  port: ClinicResetPort;
  calendarGateway?: CalendarGateway;
};

export class ResetClinicData {
  constructor(private readonly deps: ResetClinicDataDeps) {}

  async execute(input: {
    clinicId: string;
    clinicNameConfirmation: string;
    deleteCalendarEvents: boolean;
  }): Promise<ResetCounts> {
    const clinicName = await this.deps.port.findClinicName(input.clinicId);
    if (!clinicName) throw new Error("Clínica não encontrada.");

    if (input.clinicNameConfirmation.trim() !== clinicName.trim()) {
      throw new Error("Nome da clínica não confere. Operação cancelada.");
    }

    let calendarEventsDeleted = 0;

    if (input.deleteCalendarEvents && this.deps.calendarGateway) {
      const calendarIds = await this.deps.port.listAppointmentCalendarIds(input.clinicId);
      for (const calendarEventId of calendarIds) {
        await this.deps.calendarGateway.cancelAppointment({ calendarEventId });
        calendarEventsDeleted++;
      }
    }

    const counts = await this.deps.port.deleteAllData(input.clinicId);
    return { ...counts, calendarEventsDeleted };
  }
}
