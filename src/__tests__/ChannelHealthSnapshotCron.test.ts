import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/cron/channel-health-snapshot/route";
import { NextRequest } from "next/server";
import { db } from "@/infrastructure/db/client";

vi.mock("@/app/api/cron/_auth", () => ({
  requireCronAuthorization: vi.fn().mockReturnValue(null), // Bypass auth
}));

vi.mock("@/infrastructure/db/client", () => ({
  db: {
    query: {
      organizations: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

describe("Cron channel-health-snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("consolida estatísticas e salva snapshots com sucesso", async () => {
    // 1. Mock das organizações ativas e das consultas de contagem subsequentes
    let queryIndex = 0;
    const selectMock = vi.fn().mockImplementation(() => {
      if (queryIndex === 0) {
        queryIndex++;
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([
            { id: "clinic-123", name: "Clinica Teste", timezone: "America/Sao_Paulo" }
          ]),
        };
      }

      const countMockResults = [
        [{ count: 2 }],   // optOutCount
        [{ count: 100 }], // outboundSent
        [{ count: 40 }],  // inboundReceived
        [{ count: 1 }],   // outboundCancelled
        [{ count: 0 }],   // outboundDeferred
        [{ count: 5 }],   // conversationsResult
      ];

      const idx = (queryIndex - 1) % countMockResults.length;
      queryIndex++;
      const mockResult = countMockResults[idx];

      return {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(mockResult),
      };
    });

    db.select = selectMock;

    const insertMock = vi.fn().mockImplementation(() => ({
      values: vi.fn().mockResolvedValue({}),
    }));
    db.insert = insertMock;

    const updateMock = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockResolvedValue({}),
      })),
    }));
    db.update = updateMock;

    const req = new NextRequest("http://localhost/api/cron/channel-health-snapshot");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.processedCount).toBe(1);

    // Para stats { optOutCount: 2, outboundSent: 100, inboundReceived: 40 }:
    // optOutRate = 2/100 = 2% => penalty = 10
    // responseRate = 40/100 = 40% => sem penalidade
    // score final = 100 - 10 = 90 => modo normal
    expect(json.results[0].healthScore).toBe(90);
    expect(json.results[0].resolvedMode).toBe("normal");

    // Verifica se inseriu o snapshot diário no banco
    expect(insertMock).toHaveBeenCalled();
    // Verifica se atualizou a tabela de organizações
    expect(updateMock).toHaveBeenCalled();
  });
});
