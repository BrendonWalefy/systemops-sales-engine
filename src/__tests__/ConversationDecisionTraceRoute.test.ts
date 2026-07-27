import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionClinicId: vi.fn(),
  db: { select: vi.fn() },
  listByConversation: vi.fn(),
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  getSessionClinicId: mocks.getSessionClinicId,
}));
vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));
vi.mock("@/infrastructure/repositories/drizzle-decision-trace-store", () => ({
  DrizzleDecisionTraceStore: class {
    listByConversation = mocks.listByConversation;
  },
}));

import { GET } from "@/app/api/conversations/[conversationId]/decision-trace/route";

function query(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

describe("conversation decision trace route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionClinicId.mockResolvedValue("clinic-1");
    mocks.db.select.mockReturnValue(query([{ id: "conversation-1" }]));
    mocks.listByConversation.mockResolvedValue([{
      events: [{
        turnId: "turn-1",
        stage: "intent.resolved",
        occurredAt: "2026-07-26T12:00:00.000Z",
        clinicId: "clinic-1",
        conversationId: "conversation-1",
        metadata: { finalIntent: "location" },
      }],
    }]);
  });

  it("devolve somente o trace da conversa validada no tenant", async () => {
    const response = await GET(new Request("http://systemops.test"), {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      conversationId: "conversation-1",
      events: [expect.objectContaining({
        schemaVersion: "decision-trace.v1",
        sequence: 0,
        stage: "intent.resolved",
      })],
    });
    expect(mocks.listByConversation).toHaveBeenCalledWith(
      "clinic-1",
      "conversation-1",
    );
  });

  it("não consulta traces sem sessão", async () => {
    mocks.getSessionClinicId.mockResolvedValue(null);
    const response = await GET(new Request("http://systemops.test"), {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });
    expect(response.status).toBe(401);
    expect(mocks.listByConversation).not.toHaveBeenCalled();
  });

  it("não expõe traces de uma conversa de outra clínica", async () => {
    mocks.db.select.mockReturnValue(query([]));
    const response = await GET(new Request("http://systemops.test"), {
      params: Promise.resolve({ conversationId: "other-conversation" }),
    });
    expect(response.status).toBe(404);
    expect(mocks.listByConversation).not.toHaveBeenCalled();
  });
});
