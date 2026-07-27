import { randomUUID } from "node:crypto";
import type {
  BlockEvent,
  CalendarGateway,
} from "@/application/ports/calendar-gateway";
import type { Appointment } from "@/domain/entities/calendar-slot";
import { runtimeNow } from "@/core/time/RuntimeClock";

export type ReplayCalendarEffect =
  | {
      sequence: number;
      kind: "appointment.create";
      clinicId: string;
      leadId: string;
      startsAt: string;
      endsAt: string;
      title: string;
      capturedEventId: string;
    }
  | {
      sequence: number;
      kind: "appointment.cancel";
      calendarEventId: string;
    }
  | {
      sequence: number;
      kind: "appointment.update";
      calendarEventId: string;
      startsAt: string;
      endsAt: string;
    }
  | {
      sequence: number;
      kind: "block.create";
      clinicId: string;
      startsAt: string;
      endsAt: string;
      reason: string;
      capturedEventId: string;
    }
  | {
      sequence: number;
      kind: "block.delete";
      calendarEventId: string;
    }
  | {
      sequence: number;
      kind: "block.update";
      calendarEventId: string;
      startsAt: string;
      endsAt: string;
      reason: string;
    };

/**
 * Reads are delegated to a snapshot-backed gateway. Writes never reach an
 * external calendar: they are captured while returning the same domain shapes
 * expected by BookingService and the orchestrator.
 */
export class ReplayCalendarCapture implements CalendarGateway {
  readonly effects: ReplayCalendarEffect[] = [];
  private sequence = 0;

  constructor(private readonly readGateway: CalendarGateway) {}

  listAvailableSlots: CalendarGateway["listAvailableSlots"] = (input) =>
    this.readGateway.listAvailableSlots(input);

  listBlockEvents: CalendarGateway["listBlockEvents"] = (input) =>
    this.readGateway.listBlockEvents(input);

  isSlotFree: CalendarGateway["isSlotFree"] = (input) =>
    this.readGateway.isSlotFree(input);

  async createAppointment(
    input: Parameters<CalendarGateway["createAppointment"]>[0],
  ): Promise<Appointment> {
    const now = runtimeNow();
    const capturedEventId = `replay-calendar-${randomUUID()}`;
    this.effects.push({
      sequence: ++this.sequence,
      kind: "appointment.create",
      clinicId: input.clinicId,
      leadId: input.leadId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      title: input.title,
      capturedEventId,
    });
    return {
      id: randomUUID(),
      clinicId: input.clinicId,
      leadId: input.leadId,
      professionalId: null,
      roomId: null,
      description: null,
      calendarEventId: capturedEventId,
      calendarEventUrl: null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: "scheduled",
      source: "app",
      origin: null,
      reminderSentAt: null,
      treatmentId: null,
      valueCents: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async cancelAppointment(
    input: Parameters<CalendarGateway["cancelAppointment"]>[0],
  ): Promise<void> {
    this.effects.push({
      sequence: ++this.sequence,
      kind: "appointment.cancel",
      calendarEventId: input.calendarEventId,
    });
  }

  async updateCalendarEvent(
    input: Parameters<CalendarGateway["updateCalendarEvent"]>[0],
  ): Promise<void> {
    this.effects.push({
      sequence: ++this.sequence,
      kind: "appointment.update",
      calendarEventId: input.calendarEventId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
    });
  }

  async createBlockEvent(
    input: Parameters<CalendarGateway["createBlockEvent"]>[0],
  ): Promise<BlockEvent> {
    const capturedEventId = `replay-block-${randomUUID()}`;
    this.effects.push({
      sequence: ++this.sequence,
      kind: "block.create",
      clinicId: input.clinicId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      reason: input.reason,
      capturedEventId,
    });
    return {
      calendarEventId: capturedEventId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
    };
  }

  async deleteBlockEvent(
    input: Parameters<CalendarGateway["deleteBlockEvent"]>[0],
  ): Promise<void> {
    this.effects.push({
      sequence: ++this.sequence,
      kind: "block.delete",
      calendarEventId: input.calendarEventId,
    });
  }

  async updateBlockEvent(
    input: Parameters<CalendarGateway["updateBlockEvent"]>[0],
  ): Promise<BlockEvent> {
    this.effects.push({
      sequence: ++this.sequence,
      kind: "block.update",
      calendarEventId: input.calendarEventId,
      startsAt: input.startsAt.toISOString(),
      endsAt: input.endsAt.toISOString(),
      reason: input.reason,
    });
    return {
      calendarEventId: input.calendarEventId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
    };
  }
}
