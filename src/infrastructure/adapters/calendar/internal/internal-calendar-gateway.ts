import { and, eq, gt, inArray, lt } from "drizzle-orm";
import type { BlockEvent, CalendarGateway } from "@/application/ports/calendar-gateway";
import type { Appointment, CalendarSlot } from "@/domain/entities/calendar-slot";
import { ClinicTimezone, parseBusinessHours } from "@/core/scheduling/ClinicTimezone";
import { computeAvailableSlots } from "@/core/scheduling/SlotEngine";
import {
  buildBusyEvents,
  hasOverlap,
  type BusyEvent,
} from "@/core/scheduling/internal-availability";
import { db } from "@/infrastructure/db/client";
import { appointments, calendarBlocks } from "@/infrastructure/db/schema";

/**
 * Gateway de calendário cuja FONTE DE VERDADE é o banco de dados.
 *
 * Disponibilidade = businessHours da clínica menos (appointments ativos + calendar_blocks).
 * Sem chamadas externas. Reutiliza a mesma engine pura (computeAvailableSlots) que o
 * GoogleCalendarGateway, garantindo paridade de lógica de slots.
 *
 * Escrita (createAppointment / cancelAppointment / updateCalendarEvent) é no-op de
 * calendário externo: o BookingService e o use-case updateAppointment já persistem o
 * appointment no banco. Aqui só construímos/validamos.
 *
 * TODO (Fase C): quando professionals.workSchedule e rooms tiverem shape definido,
 * usar a janela do profissional/sala em vez do businessHours da clínica.
 */
export class InternalCalendarGateway implements CalendarGateway {
  private readonly timezone: ClinicTimezone;
  private readonly businessHours: string | null;
  private readonly postAppointmentBufferMinutes: number;

  constructor(params: {
    timezone?: ClinicTimezone;
    businessHours?: string | null;
    postAppointmentBufferMinutes?: number;
  }) {
    this.timezone = params.timezone ?? new ClinicTimezone("America/Sao_Paulo");
    this.businessHours = params.businessHours ?? null;
    this.postAppointmentBufferMinutes = params.postAppointmentBufferMinutes ?? 0;
  }

  /** Appointments ativos + bloqueios que colidem com a janela [from, to). */
  private async loadBusyEvents(input: {
    clinicId: string;
    from: Date;
    to: Date;
    professionalId?: string;
  }): Promise<BusyEvent[]> {
    const apptRows = await db
      .select({
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        professionalId: appointments.professionalId,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.clinicId, input.clinicId),
          inArray(appointments.status, ["scheduled", "confirmed"]),
          lt(appointments.startsAt, input.to),
          gt(appointments.endsAt, input.from),
        ),
      );

    const blockRows = await db
      .select({
        startsAt: calendarBlocks.startsAt,
        endsAt: calendarBlocks.endsAt,
        professionalId: calendarBlocks.professionalId,
      })
      .from(calendarBlocks)
      .where(
        and(
          eq(calendarBlocks.clinicId, input.clinicId),
          lt(calendarBlocks.startsAt, input.to),
          gt(calendarBlocks.endsAt, input.from),
        ),
      );

    return buildBusyEvents({
      appointments: apptRows,
      blocks: blockRows,
      professionalId: input.professionalId,
    });
  }

  async listAvailableSlots(input: {
    clinicId: string;
    from: Date;
    to: Date;
    slotDurationMinutes: number;
    professionalId?: string;
  }): Promise<CalendarSlot[]> {
    const existingEvents = await this.loadBusyEvents(input);

    return computeAvailableSlots({
      timezone: this.timezone,
      businessHours: parseBusinessHours(this.businessHours),
      existingEvents,
      from: input.from,
      to: input.to,
      slotDurationMinutes: input.slotDurationMinutes,
      clinicId: input.clinicId,
      postEventBufferMinutes: this.postAppointmentBufferMinutes,
    }).map((slot) => ({ ...slot, source: "manual" }));
  }

  async isSlotFree(input: {
    clinicId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<boolean> {
    const busy = await this.loadBusyEvents({
      clinicId: input.clinicId,
      from: input.startsAt,
      to: input.endsAt,
    });
    return !hasOverlap(busy, input.startsAt, input.endsAt);
  }

  /**
   * No modo interno não há evento externo: apenas construímos o appointment de domínio.
   * O BookingService persiste em seguida via appointmentRepo.save().
   */
  async createAppointment(input: {
    clinicId: string;
    leadId: string;
    startsAt: Date;
    endsAt: Date;
    title: string;
  }): Promise<Appointment> {
    const now = new Date();
    return {
      id: crypto.randomUUID(),
      clinicId: input.clinicId,
      leadId: input.leadId,
      professionalId: null,
      roomId: null,
      calendarEventId: null,
      calendarEventUrl: null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "scheduled",
      source: "app",
      reminderSentAt: null,
      treatmentId: null,
      valueCents: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  // Cancelamento/edição do appointment são tratados no banco pelo BookingService e
  // pelo use-case updateAppointment. Sem evento externo, estes são no-ops.
  async cancelAppointment(input: { calendarEventId: string }): Promise<void> {
    void input;
  }

  async updateCalendarEvent(input: {
    calendarEventId: string;
    startsAt: Date;
    endsAt: Date;
  }): Promise<void> {
    void input;
  }

  async listBlockEvents(input: {
    clinicId: string;
    from: Date;
    to: Date;
  }): Promise<BlockEvent[]> {
    const rows = await db
      .select()
      .from(calendarBlocks)
      .where(
        and(
          eq(calendarBlocks.clinicId, input.clinicId),
          lt(calendarBlocks.startsAt, input.to),
          gt(calendarBlocks.endsAt, input.from),
        ),
      );

    return rows.map((r) => ({
      calendarEventId: r.id,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      reason: r.reason,
    }));
  }

  async createBlockEvent(input: {
    clinicId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
  }): Promise<BlockEvent> {
    const [row] = await db
      .insert(calendarBlocks)
      .values({
        clinicId: input.clinicId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason,
      })
      .returning();

    return {
      calendarEventId: row.id,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      reason: row.reason,
    };
  }

  async deleteBlockEvent(input: { calendarEventId: string }): Promise<void> {
    await db.delete(calendarBlocks).where(eq(calendarBlocks.id, input.calendarEventId));
  }
}
