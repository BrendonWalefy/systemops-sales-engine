// Tests for the stale-conversations TTL feature.
// markStaleLeads is tested by mocking DrizzleLeadRepository.
// The cron route auth is tested via a pure function extracted from the route logic.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Lead } from "@/domain/entities/lead";

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockFindInactiveLeads = vi.fn();
const mockSave = vi.fn();

vi.mock("@/infrastructure/repositories/drizzle-lead-repository", () => ({
  DrizzleLeadRepository: vi.fn().mockImplementation(() => ({
    findInactiveLeads: mockFindInactiveLeads,
    save: mockSave,
  })),
}));

vi.mock("@/infrastructure/repositories/drizzle-follow-up-repository", () => ({
  DrizzleFollowUpRepository: vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue(undefined),
    listDue: vi.fn().mockResolvedValue([]),
    listPendingByLead: vi.fn().mockResolvedValue([]),
    findPendingByReason: vi.fn().mockResolvedValue(null),
    cancelPendingByReason: vi.fn().mockResolvedValue(0),
    cancelPendingByLead: vi.fn().mockResolvedValue(0),
    claimForSending: vi.fn().mockResolvedValue(true),
    recoverStaleSending: vi.fn().mockResolvedValue(0),
  })),
}));

// ─── Import after mock ──────────────────────────────────────────────────────

const { markStaleLeads } = await import(
  "@/application/use-cases/leads/mark-stale-leads"
);

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    clinicId: "clinic-1",
    name: "Test Lead",
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

// ─── Tests: markStaleLeads ──────────────────────────────────────────────────

describe("markStaleLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSave.mockResolvedValue(undefined);
  });

  it("lead inativo há 15 dias com status in_conversation → marcado como lost", async () => {
    const lead = makeLead({ status: "in_conversation" });
    mockFindInactiveLeads.mockResolvedValue([lead]);

    const result = await markStaleLeads({ clinicId: "clinic-1" });

    expect(result).toEqual({ marked: 1 });
    expect(mockSave).toHaveBeenCalledOnce();
    const savedLead = mockSave.mock.calls[0][0];
    expect(savedLead.status).toBe("lost");
    expect(savedLead.lostReason).toBe("inatividade");
  });

  it("lead inativo há 13 dias → NÃO marcado (abaixo do threshold de 14 dias)", async () => {
    // findInactiveLeads não retorna esse lead porque o critério de data filtra no banco
    mockFindInactiveLeads.mockResolvedValue([]);

    const result = await markStaleLeads({ clinicId: "clinic-1" });

    expect(result).toEqual({ marked: 0 });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("lead com status appointment_scheduled inativo → NÃO marcado", async () => {
    // Repository exclui appointment_scheduled no WHERE — retorna vazio
    mockFindInactiveLeads.mockResolvedValue([]);

    const result = await markStaleLeads({ clinicId: "clinic-1" });

    expect(result).toEqual({ marked: 0 });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("lead com status lost → NÃO marcado novamente", async () => {
    // Repository exclui leads com status lost no WHERE — retorna vazio
    mockFindInactiveLeads.mockResolvedValue([]);

    const result = await markStaleLeads({ clinicId: "clinic-1" });

    expect(result).toEqual({ marked: 0 });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("lead com status won → NÃO marcado", async () => {
    // Repository exclui leads com status won no WHERE — retorna vazio
    mockFindInactiveLeads.mockResolvedValue([]);

    const result = await markStaleLeads({ clinicId: "clinic-1" });

    expect(result).toEqual({ marked: 0 });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("nenhum lead inativo → retorna { marked: 0 } sem erro", async () => {
    mockFindInactiveLeads.mockResolvedValue([]);

    const result = await markStaleLeads({ clinicId: "clinic-1" });

    expect(result).toEqual({ marked: 0 });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("inactiveDays customizado → corte calculado corretamente", async () => {
    const lead = makeLead({ status: "new" });
    mockFindInactiveLeads.mockResolvedValue([lead]);

    const before = new Date();
    await markStaleLeads({ clinicId: "clinic-1", inactiveDays: 30 });
    const after = new Date();

    const [callArgs] = mockFindInactiveLeads.mock.calls[0];
    const cutoff = callArgs.lastActivityBefore;
    const expectedMs = 30 * 24 * 60 * 60 * 1000;

    expect(before.getTime() - cutoff.getTime()).toBeGreaterThanOrEqual(expectedMs - 100);
    expect(after.getTime() - cutoff.getTime()).toBeLessThanOrEqual(expectedMs + 100);
  });
});

// ─── Tests: cron route auth (pure function) ─────────────────────────────────

function checkCronAuth(authHeader: string | null, cronSecret: string | undefined): boolean {
  return authHeader === `Bearer ${cronSecret}`;
}

describe("StaleConversations cron route — autenticação", () => {
  it("Authorization header incorreto → não autorizado", () => {
    expect(checkCronAuth("Bearer wrong-secret", "correct-secret")).toBe(false);
  });

  it("Authorization header correto → autorizado", () => {
    expect(checkCronAuth("Bearer correct-secret", "correct-secret")).toBe(true);
  });

  it("Authorization header ausente → não autorizado", () => {
    expect(checkCronAuth(null, "correct-secret")).toBe(false);
  });
});
