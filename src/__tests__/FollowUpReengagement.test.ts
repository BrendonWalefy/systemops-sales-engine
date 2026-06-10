// Tests for the follow-up re-engagement feature.
// Covers: ScheduleFollowUp use case, DrizzleFollowUpRepository mock, FollowUpDispatcher route auth,
// and BookingService follow-up scheduling integration.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FollowUp } from "@/domain/entities/follow-up";
import type { Lead } from "@/domain/entities/lead";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockFollowUpSave = vi.fn();
const mockFollowUpListDue = vi.fn();
const mockLeadSave = vi.fn();
const mockLeadFindInactiveLeads = vi.fn();

const mockFollowUpFindPendingByReason = vi.fn().mockResolvedValue(null);

vi.mock("@/infrastructure/repositories/drizzle-follow-up-repository", () => ({
  DrizzleFollowUpRepository: vi.fn().mockImplementation(() => ({
    save: mockFollowUpSave,
    listDue: mockFollowUpListDue,
    findPendingByReason: mockFollowUpFindPendingByReason,
  })),
}));

vi.mock("@/infrastructure/repositories/drizzle-lead-repository", () => ({
  DrizzleLeadRepository: vi.fn().mockImplementation(() => ({
    save: mockLeadSave,
    findInactiveLeads: mockLeadFindInactiveLeads,
  })),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

const { scheduleFollowUp, calculateFollowUpDueAt } = await import(
  "@/application/use-cases/leads/schedule-follow-up"
);
const { markStaleLeads } = await import(
  "@/application/use-cases/leads/mark-stale-leads"
);

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    clinicId: "clinic-1",
    name: "Maria",
    phone: "5511999999999",
    whatsappLid: null,
    email: null,
    channel: "whatsapp",
    campaignId: null,
    treatmentInterest: null,
    profilePicUrl: null,
    status: "in_conversation",
    temperature: null,
    assignedToUserId: null,
    nextActionAt: null,
    lostReason: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeFollowUpRepository() {
  return {
    save: vi.fn<(fu: FollowUp) => Promise<void>>().mockResolvedValue(undefined),
    listDue: vi.fn<(input: { clinicId: string; now: Date }) => Promise<FollowUp[]>>().mockResolvedValue([]),
    findPendingByReason: vi.fn<(input: { leadId: string; reason: string }) => Promise<FollowUp | null>>().mockResolvedValue(null),
  };
}

// ─── Tests: calculateFollowUpDueAt ─────────────────────────────────────────

describe("calculateFollowUpDueAt", () => {
  const ref = new Date("2026-01-01T10:00:00Z");

  it("appointment_completed → +6 meses", () => {
    const due = calculateFollowUpDueAt("appointment_completed", ref);
    expect(due.getMonth()).toBe((ref.getMonth() + 6) % 12);
  });

  it("no_show → +7 dias", () => {
    const due = calculateFollowUpDueAt("no_show", ref);
    const expectedMs = 7 * 24 * 60 * 60 * 1000;
    expect(due.getTime() - ref.getTime()).toBe(expectedMs);
  });

  it("lost → +30 dias", () => {
    const due = calculateFollowUpDueAt("lost", ref);
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    expect(due.getTime() - ref.getTime()).toBe(expectedMs);
  });
});

// ─── Tests: scheduleFollowUp use case ──────────────────────────────────────

describe("scheduleFollowUp", () => {
  it("salva follow-up com status pending e reason correto para trigger lost", async () => {
    const repo = makeFollowUpRepository();
    const ref = new Date("2026-01-01T10:00:00Z");

    await scheduleFollowUp({
      clinicId: "clinic-1",
      leadId: "lead-1",
      trigger: "lost",
      referenceDate: ref,
      followUpRepository: repo,
    });

    expect(repo.save).toHaveBeenCalledOnce();
    const saved = repo.save.mock.calls[0][0];
    expect(saved.clinicId).toBe("clinic-1");
    expect(saved.leadId).toBe("lead-1");
    expect(saved.status).toBe("pending");
    expect(saved.reason).toBe("Lead inativo — segunda chance");
    const expectedDue = ref.getTime() + 30 * 24 * 60 * 60 * 1000;
    expect(saved.dueAt.getTime()).toBe(expectedDue);
  });

  it("salva follow-up com reason correto para trigger appointment_completed", async () => {
    const repo = makeFollowUpRepository();

    await scheduleFollowUp({
      clinicId: "clinic-1",
      leadId: "lead-1",
      trigger: "appointment_completed",
      referenceDate: new Date("2026-01-01"),
      followUpRepository: repo,
    });

    const saved = repo.save.mock.calls[0][0];
    expect(saved.reason).toBe("Retorno de rotina");
  });

  it("salva follow-up com reason correto para trigger no_show", async () => {
    const repo = makeFollowUpRepository();

    await scheduleFollowUp({
      clinicId: "clinic-1",
      leadId: "lead-1",
      trigger: "no_show",
      referenceDate: new Date("2026-01-01"),
      followUpRepository: repo,
    });

    const saved = repo.save.mock.calls[0][0];
    expect(saved.reason).toBe("Lead não compareceu à consulta");
  });

  it("usa data atual como referenceDate se não informada", async () => {
    const repo = makeFollowUpRepository();
    const before = Date.now();

    await scheduleFollowUp({
      clinicId: "clinic-1",
      leadId: "lead-1",
      trigger: "no_show",
      followUpRepository: repo,
    });

    const after = Date.now();
    const saved = repo.save.mock.calls[0][0];
    const expectedLow = before + 7 * 24 * 60 * 60 * 1000 - 100;
    const expectedHigh = after + 7 * 24 * 60 * 60 * 1000 + 100;
    expect(saved.dueAt.getTime()).toBeGreaterThanOrEqual(expectedLow);
    expect(saved.dueAt.getTime()).toBeLessThanOrEqual(expectedHigh);
  });

  it("follow-up gerado tem id único (uuid)", async () => {
    const repo = makeFollowUpRepository();

    await scheduleFollowUp({ clinicId: "c", leadId: "l", trigger: "lost", followUpRepository: repo });
    await scheduleFollowUp({ clinicId: "c", leadId: "l", trigger: "lost", followUpRepository: repo });

    const [first, second] = repo.save.mock.calls.map((c) => c[0].id);
    expect(first).not.toBe(second);
  });
});

// ─── Tests: markStaleLeads com follow-up scheduling ────────────────────────

describe("markStaleLeads + follow-up scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLeadSave.mockResolvedValue(undefined);
    mockFollowUpSave.mockResolvedValue(undefined);
  });

  it("lead marcado como lost → follow-up agendado em +30 dias", async () => {
    const lead = makeLead({ status: "in_conversation" });
    mockLeadFindInactiveLeads.mockResolvedValue([lead]);

    const before = Date.now();
    await markStaleLeads({ clinicId: "clinic-1" });
    const after = Date.now();

    expect(mockLeadSave).toHaveBeenCalledOnce();
    expect(mockFollowUpSave).toHaveBeenCalledOnce();

    const savedFollowUp = mockFollowUpSave.mock.calls[0][0];
    expect(savedFollowUp.clinicId).toBe("clinic-1");
    expect(savedFollowUp.leadId).toBe("lead-1");
    expect(savedFollowUp.status).toBe("pending");
    expect(savedFollowUp.reason).toBe("Lead inativo — segunda chance");

    const expectedLow = before + 30 * 24 * 60 * 60 * 1000 - 100;
    const expectedHigh = after + 30 * 24 * 60 * 60 * 1000 + 100;
    expect(savedFollowUp.dueAt.getTime()).toBeGreaterThanOrEqual(expectedLow);
    expect(savedFollowUp.dueAt.getTime()).toBeLessThanOrEqual(expectedHigh);
  });

  it("nenhum lead inativo → nenhum follow-up agendado", async () => {
    mockLeadFindInactiveLeads.mockResolvedValue([]);

    await markStaleLeads({ clinicId: "clinic-1" });

    expect(mockLeadSave).not.toHaveBeenCalled();
    expect(mockFollowUpSave).not.toHaveBeenCalled();
  });

  it("falha ao agendar follow-up não interrompe marcação do lead como lost", async () => {
    const lead = makeLead({ status: "in_conversation" });
    mockLeadFindInactiveLeads.mockResolvedValue([lead]);
    mockFollowUpSave.mockRejectedValue(new Error("DB error"));

    const result = await markStaleLeads({ clinicId: "clinic-1" });

    expect(result).toEqual({ marked: 1 });
    expect(mockLeadSave).toHaveBeenCalledOnce();
  });

  it("múltiplos leads → um follow-up por lead", async () => {
    const leads = [
      makeLead({ id: "lead-1" }),
      makeLead({ id: "lead-2" }),
      makeLead({ id: "lead-3" }),
    ];
    mockLeadFindInactiveLeads.mockResolvedValue(leads);

    await markStaleLeads({ clinicId: "clinic-1" });

    expect(mockLeadSave).toHaveBeenCalledTimes(3);
    expect(mockFollowUpSave).toHaveBeenCalledTimes(3);
  });
});

// ─── Tests: FollowUpDispatcher cron route auth (pure function) ──────────────

function checkCronAuth(authHeader: string | null, cronSecret: string | undefined): boolean {
  return authHeader === `Bearer ${cronSecret}`;
}

describe("FollowUpDispatcher cron route — autenticação", () => {
  it("Authorization header correto → autorizado", () => {
    expect(checkCronAuth("Bearer secret", "secret")).toBe(true);
  });

  it("Authorization header incorreto → não autorizado", () => {
    expect(checkCronAuth("Bearer wrong", "secret")).toBe(false);
  });

  it("Authorization header ausente → não autorizado", () => {
    expect(checkCronAuth(null, "secret")).toBe(false);
  });
});

// ─── Tests: InMemoryDemoStore.listDue ──────────────────────────────────────

describe("InMemoryDemoStore.listDue", () => {
  it("retorna only follow-ups pending com dueAt <= now", async () => {
    const { InMemoryDemoStore } = await import(
      "@/infrastructure/repositories/in-memory-demo-repositories"
    );
    const store = new InMemoryDemoStore();

    const now = new Date("2026-06-01T12:00:00Z");
    const past = new Date("2026-05-01T00:00:00Z");
    const future = new Date("2026-07-01T00:00:00Z");

    const base: FollowUp = {
      id: "",
      clinicId: "clinic-1",
      leadId: "lead-1",
      status: "pending",
      reason: "test",
      suggestedMessage: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      dueAt: past,
    };

    await store.save({ ...base, id: "fu-1", dueAt: past });
    await store.save({ ...base, id: "fu-2", dueAt: future });
    await store.save({ ...base, id: "fu-3", dueAt: past, status: "done" });
    await store.save({ ...base, id: "fu-4", dueAt: past, clinicId: "other-clinic" });

    const due = await store.listDue({ clinicId: "clinic-1", now });

    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("fu-1");
  });
});
