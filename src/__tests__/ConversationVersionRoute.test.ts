import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionClinicId: vi.fn(),
  db: { select: vi.fn() },
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  getSessionClinicId: mocks.getSessionClinicId,
}));

vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));

import { GET } from "@/app/api/conversations/[conversationId]/version/route";

function query(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

describe("conversation version route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionClinicId.mockResolvedValue("clinic-1");
    mocks.db.select.mockReturnValue(query([
      { id: "conversation-1", updatedAt: new Date("2026-06-23T12:00:00.000Z") },
    ]));
  });

  it("returns a small version for a conversation in the session clinic", async () => {
    const response = await GET(new Request("http://systemops.test"), {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: "2026-06-23T12:00:00.000Z",
    });
  });

  it("rejects a request without a clinic session", async () => {
    mocks.getSessionClinicId.mockResolvedValue(null);

    const response = await GET(new Request("http://systemops.test"), {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });

    expect(response.status).toBe(401);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("does not expose a conversation outside the session clinic", async () => {
    mocks.db.select.mockReturnValue(query([]));

    const response = await GET(new Request("http://systemops.test"), {
      params: Promise.resolve({ conversationId: "other-clinic-conversation" }),
    });

    expect(response.status).toBe(404);
  });
});
