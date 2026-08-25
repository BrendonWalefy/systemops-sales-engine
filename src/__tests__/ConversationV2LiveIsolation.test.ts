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
    const calendar = createTenantScopedCalendarGateway({ resolveGateway });

    await expect(Promise.all(turns.map((turn) => calendar.listAvailableSlots({
      clinicId: turn.clinicId,
      from: new Date(0),
      to: new Date(1),
      slotDurationMinutes: 30,
    })))).resolves.toEqual([
      [{ clinicId: "clinic-a" }],
      [{ clinicId: "clinic-b" }],
    ]);
    expect(resolveGateway.mock.calls.map(([clinicId]) => clinicId)).toEqual([
      "clinic-a",
      "clinic-b",
    ]);
  });

  it("rejects a cross-tenant calendar result before a scheduling effect", async () => {
    const createAppointment = vi.fn();
    const calendar = createTenantScopedCalendarGateway({
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
});
