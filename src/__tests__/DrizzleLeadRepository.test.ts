import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/domain/entities/lead";

const dbMock = vi.hoisted(() => ({
  query: {
    leads: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

import { DrizzleLeadRepository } from "@/infrastructure/repositories/drizzle-lead-repository";

function lead(overrides: Partial<Lead> = {}): Lead {
  const now = new Date("2026-07-18T00:00:00.000Z");
  return {
    id: "lead-1",
    clinicId: "clinic-1",
    name: "Pamela",
    phone: "5511999999999",
    whatsappLid: "123456789@lid",
    email: null,
    channel: "whatsapp",
    campaignId: null,
    treatmentInterest: null,
    profilePicUrl: null,
    status: "waiting_response",
    temperature: "warm",
    assignedToUserId: null,
    nextActionAt: null,
    lostReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function updateChain() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  };
}

describe("DrizzleLeadRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("atualiza o lead encontrado por LID quando o webhook traz telefone novo e LID existente", async () => {
    const existingByLid = lead({
      id: "lead-by-lid",
      phone: null,
      whatsappLid: "123456789@lid",
    });
    const update = updateChain();
    dbMock.query.leads.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingByLid);
    dbMock.update.mockReturnValue(update);

    await new DrizzleLeadRepository().save(lead({ id: "incoming-lead" }));

    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).toHaveBeenCalledOnce();
    expect(update.set).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "5511999999999",
        whatsappLid: "123456789@lid",
        status: "waiting_response",
      }),
    );
  });
});
