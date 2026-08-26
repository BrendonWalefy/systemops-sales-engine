import { describe, expect, it, vi } from "vitest";
import type {
  ConversationHandleInput,
  ConversationHandleResult,
  ConversationHandler,
} from "@/application/ports/conversation-handler";
import {
  createConversationV2Runtime,
  createTenantScopedCalendarGateway,
  V2CalendarTenantScopeError,
} from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";
import { BookingService } from "@/core/scheduling/BookingService";

const turns = [
  {
    clinicId: "clinic-a",
    phone: "tenant-a-address",
    messageText: "tenant-a-input",
    messageId: "provider-a",
    turnId: "turn-a",
    timestamp: new Date("2026-08-25T12:00:00.000Z"),
    automationMode: "live" as const,
  },
  {
    clinicId: "clinic-b",
    phone: "tenant-b-address",
    messageText: "tenant-b-input",
    messageId: "provider-b",
    turnId: "turn-b",
    timestamp: new Date("2026-08-25T12:00:01.000Z"),
    automationMode: "live" as const,
  },
] as const satisfies readonly ConversationHandleInput[];

class TenantRecordingV2Handler implements ConversationHandler {
  readonly received: ConversationHandleInput[] = [];

  async handle(input: ConversationHandleInput): Promise<ConversationHandleResult> {
    this.received.push(input);
    return { replied: true, reason: `v2:${input.clinicId}` };
  }
}

describe("Conversation V2 live tenant isolation", () => {
  it("sends two tenants directly to the same V2-only boundary without engine selection", async () => {
    const v2 = new TenantRecordingV2Handler();
    const runtime = createConversationV2Runtime({
      env: {},
      v2Handler: v2,
      clinicFactsReader: { getAutomationFacts: async () => null },
      conversationAuthorityStore: { getVersion: async () => 0 },
      conversationRuntimeControlStore: {
        getGlobal: async () => ({ liveOutboundEnabled: false, version: 0 }),
      },
    });

    await expect(Promise.all(turns.map((turn) =>
      runtime.conversationHandler.handle(turn),
    ))).resolves.toEqual([
      { replied: true, reason: "v2:clinic-a" },
      { replied: true, reason: "v2:clinic-b" },
    ]);
    expect(v2.received.map(({ clinicId, turnId }) => ({ clinicId, turnId }))).toEqual([
      { clinicId: "clinic-a", turnId: "turn-a" },
      { clinicId: "clinic-b", turnId: "turn-b" },
    ]);
  });

  it("resolves distinct calendar adapters from each immutable claimed clinic", async () => {
    const adapters = new Map([
      ["clinic-a", { listAvailableSlots: vi.fn().mockResolvedValue([{ clinicId: "clinic-a" }]) }],
      ["clinic-b", { listAvailableSlots: vi.fn().mockResolvedValue([{ clinicId: "clinic-b" }]) }],
    ]);
    const resolveGateway = vi.fn(async (clinicId: string) => {
      const gateway = adapters.get(clinicId);
      if (!gateway) throw new Error("missing tenant calendar");
      return gateway as never;
    });
    const calendar = createTenantScopedCalendarGateway({
      claimedClinicId: "clinic-a",
      resolveGateway,
    });

    await expect(calendar.listAvailableSlots({
      clinicId: "clinic-a",
      from: new Date(0),
      to: new Date(1),
      slotDurationMinutes: 30,
    })).resolves.toEqual([{ clinicId: "clinic-a" }]);
    expect(resolveGateway.mock.calls.map(([clinicId]) => clinicId)).toEqual([
      "clinic-a",
    ]);
  });

  it("rejects a cross-tenant calendar result before a scheduling effect", async () => {
    const createAppointment = vi.fn();
    const calendar = createTenantScopedCalendarGateway({
      claimedClinicId: "clinic-a",
      resolveGateway: vi.fn(async () => ({
        listAvailableSlots: vi.fn().mockResolvedValue([{ clinicId: "clinic-b" }]),
        createAppointment,
      } as never)),
    });

    await expect(calendar.listAvailableSlots({
      clinicId: "clinic-a",
      from: new Date(0),
      to: new Date(1),
      slotDurationMinutes: 30,
    })).rejects.toBeInstanceOf(V2CalendarTenantScopeError);
    expect(createAppointment).not.toHaveBeenCalled();
  });

  it("rejects every cross-tenant calendar operation before resolving or calling an adapter", async () => {
    const adapterEffects = {
      listAvailableSlots: vi.fn(), createAppointment: vi.fn(), cancelAppointment: vi.fn(),
      listBlockEvents: vi.fn(), createBlockEvent: vi.fn(), deleteBlockEvent: vi.fn(),
      updateBlockEvent: vi.fn(), isSlotFree: vi.fn(), updateCalendarEvent: vi.fn(),
    };
    const resolveGateway = vi.fn().mockResolvedValue(adapterEffects);
    const calendar = createTenantScopedCalendarGateway({
      claimedClinicId: "clinic-a",
      resolveGateway,
    });
    const interval = { startsAt: new Date(0), endsAt: new Date(1) };
    const operations = [
      () => calendar.listAvailableSlots({ clinicId: "clinic-b", from: interval.startsAt, to: interval.endsAt, slotDurationMinutes: 30 }),
      () => calendar.createAppointment({ clinicId: "clinic-b", leadId: "lead-b", ...interval, title: "foreign" }),
      () => calendar.cancelAppointment({ clinicId: "clinic-b", calendarEventId: "foreign-event" } as never),
      () => calendar.listBlockEvents({ clinicId: "clinic-b", from: interval.startsAt, to: interval.endsAt }),
      () => calendar.createBlockEvent({ clinicId: "clinic-b", ...interval, reason: "foreign" }),
      () => calendar.deleteBlockEvent({ clinicId: "clinic-b", calendarEventId: "foreign-block" } as never),
      () => calendar.updateBlockEvent({ clinicId: "clinic-b", calendarEventId: "foreign-block", ...interval, reason: "foreign" } as never),
      () => calendar.isSlotFree({ clinicId: "clinic-b", ...interval }),
      () => calendar.updateCalendarEvent({ clinicId: "clinic-b", calendarEventId: "foreign-event", ...interval } as never),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toBeInstanceOf(V2CalendarTenantScopeError);
    }
    expect(resolveGateway).not.toHaveBeenCalled();
    expect(Object.values(adapterEffects).every((effect) => effect.mock.calls.length === 0)).toBe(true);
  });

  it("does not let BookingService convert a calendar tenant violation into an internal appointment", async () => {
    const appointmentSave = vi.fn();
    const calendar = createTenantScopedCalendarGateway({
      claimedClinicId: "clinic-a",
      resolveGateway: vi.fn(async () => ({
        isSlotFree: vi.fn().mockResolvedValue(true),
        createAppointment: vi.fn().mockResolvedValue({ clinicId: "clinic-b" }),
      } as never)),
    });
    const booking = new BookingService(
      calendar,
      { findByPeriod: vi.fn().mockResolvedValue([]), save: appointmentSave } as never,
      { save: vi.fn() } as never,
      {
        reserve: vi.fn().mockResolvedValue({ id: "reservation-a", status: "pending" }),
        confirm: vi.fn(), release: vi.fn(), releaseExpired: vi.fn(), releaseBySlot: vi.fn(),
      } as never,
    );

    await expect(booking.book({
      clinic: { id: "clinic-a", name: "Clinic A" } as never,
      lead: { id: "lead-a", clinicId: "clinic-a", name: "Lead A" } as never,
      startsAt: new Date("2026-08-26T12:00:00.000Z"),
      endsAt: new Date("2026-08-26T13:00:00.000Z"),
      origin: "ai_conversation",
    })).rejects.toBeInstanceOf(V2CalendarTenantScopeError);
    expect(appointmentSave).not.toHaveBeenCalled();
  });
});
