import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionClinicId: vi.fn(),
  readSession: vi.fn(),
  db: { select: vi.fn() },
  listByConversation: vi.fn(),
  listRejectionsByConversation: vi.fn(),
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  getSessionClinicId: mocks.getSessionClinicId,
  readSession: mocks.readSession,
}));
vi.mock("@/infrastructure/repositories/drizzle-ai-contract-rejection-store", () => ({
  DrizzleAiContractRejectionStore: class {
    listByConversation = mocks.listRejectionsByConversation;
  },
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
    mocks.readSession.mockResolvedValue({
      email: "staff@example.test",
      role: "clinic_admin",
    });
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
    mocks.listRejectionsByConversation.mockResolvedValue([]);
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
      summary: {
        schemaVersion: "conversation-trace-summary.v1",
        turnCount: 1,
        turns: [expect.objectContaining({
          turnId: "turn-1",
          status: "processing",
          timeline: [{
            stage: "intent.resolved",
            occurredAt: "2026-07-26T12:00:00.000Z",
            sequence: 0,
          }],
        })],
      },
    });
    expect(mocks.listByConversation).toHaveBeenCalledWith(
      "clinic-1",
      "conversation-1",
    );
  });

  it("não consulta traces sem sessão", async () => {
    mocks.readSession.mockResolvedValue(null);
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

  it("adds sanitized rejection summaries only for Owner", async () => {
    const rawSentinel = "private rejected output";
    mocks.readSession.mockResolvedValue({
      email: "owner@example.test",
      role: "owner",
    });
    mocks.listRejectionsByConversation.mockResolvedValue([{
      evidenceRef: "evidence-ref-1",
      turnId: "turn-1",
      stage: "understanding_structural",
      modelId: "gpt-4o-mini",
      promptVersion: "dental-understanding.v1",
      contractVersion: "understanding.v1",
      attempt: 1,
      issues: [{ path: [], code: "invalid_json" }],
      outputBytes: 23,
      captureStatus: "stored",
      rawAvailable: true,
      rawExpiresAt: new Date("2026-09-03T03:00:00.000Z"),
      metadataExpiresAt: new Date("2026-09-26T03:00:00.000Z"),
      createdAt: new Date("2026-08-27T03:00:00.000Z"),
      encryptedOutput: rawSentinel,
      outputSha256: "private-hash",
    }]);

    const response = await GET(new Request("http://systemops.test"), {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });
    const body = await response.json();

    expect(body.aiContractRejections).toEqual([{
      evidenceRef: "evidence-ref-1",
      turnId: "turn-1",
      stage: "understanding_structural",
      modelId: "gpt-4o-mini",
      promptVersion: "dental-understanding.v1",
      contractVersion: "understanding.v1",
      attempt: 1,
      issues: [{ path: [], code: "invalid_json" }],
      outputBytes: 23,
      captureStatus: "stored",
      rawAvailable: true,
      rawExpiresAt: "2026-09-03T03:00:00.000Z",
      metadataExpiresAt: "2026-09-26T03:00:00.000Z",
      createdAt: "2026-08-27T03:00:00.000Z",
    }]);
    expect(mocks.listRejectionsByConversation).toHaveBeenCalledWith(
      "clinic-1",
      "conversation-1",
    );
    expect(JSON.stringify(body)).not.toContain(rawSentinel);
    expect(JSON.stringify(body)).not.toContain("private-hash");
  });

  it("preserves the staff trace response without rejection metadata", async () => {
    mocks.listRejectionsByConversation.mockResolvedValue([{
      evidenceRef: "must-not-be-visible",
    }]);

    const response = await GET(new Request("http://systemops.test"), {
      params: Promise.resolve({ conversationId: "conversation-1" }),
    });
    const body = await response.json();

    expect(body).not.toHaveProperty("aiContractRejections");
    expect(mocks.listRejectionsByConversation).not.toHaveBeenCalled();
    expect(JSON.stringify(body.summary)).not.toContain("must-not-be-visible");
  });
});
