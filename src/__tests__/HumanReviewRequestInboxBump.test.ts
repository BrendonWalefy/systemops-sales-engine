// A aba "Pendências" do Inbox lê `humanReviewRequests.status = 'pending'`
// (segment-index.ts). Criar uma revisão põe a conversa na aba; decidi-la tira.
// Encontrado na varredura própria desta rodada, não nomeado pela review: a
// única invalidação que cobria isso era indireta — o orquestrador persistir
// uma mensagem logo depois. Depender de um bump vizinho é exatamente o padrão
// que já quebrou três vezes nesta branch; quem escreve, bumpa.

import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
}));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

const bumpInboxVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/read-versions/clinic-read-version", () => ({
  bumpInboxVersion: bumpInboxVersionMock,
}));

import { DrizzleHumanReviewRequestRepository } from "@/infrastructure/repositories/drizzle-human-review-request-repository";

const repo = new DrizzleHumanReviewRequestRepository();

function mockNextAvailableCode() {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ reviewCode: 7 }]),
  };
  dbMock.select.mockReturnValue(chain);
}

function mockInsertReturning(rows: unknown[]) {
  dbMock.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(rows) }),
  });
}

function mockUpdateReturning(rows: unknown[]) {
  dbMock.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue(rows) }),
    }),
  });
}

describe("DrizzleHumanReviewRequestRepository invalidação do Inbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bumpa a clínica ao criar uma revisão pendente (linha entra em Pendências)", async () => {
    mockNextAvailableCode();
    mockInsertReturning([{ id: "review-1", clinicId: "clinic-a", reviewCode: 8 }]);

    await repo.createPending({
      clinicId: "clinic-a",
      conversationId: "conv-1",
      leadId: "lead-1",
      sourceMessageId: null,
      treatmentId: null,
      targetTreatmentId: null,
      sourceMediaType: "image",
      sourceMediaUrl: null,
    });

    expect(bumpInboxVersionMock).toHaveBeenCalledExactlyOnceWith("clinic-a");
  });

  it("bumpa a clínica ao decidir a revisão (linha sai de Pendências)", async () => {
    mockUpdateReturning([{ id: "review-1", clinicId: "clinic-b", reviewCode: 8 }]);

    await repo.applyDecision({
      id: "review-1",
      decision: "approved_direct_booking",
      source: "whatsapp",
      reviewerPhone: "5511999999999",
    });

    expect(bumpInboxVersionMock).toHaveBeenCalledExactlyOnceWith("clinic-b");
  });

  it("não bumpa quando a revisão já não estava pendente (update não atinge linha)", async () => {
    mockUpdateReturning([]);

    const result = await repo.applyDecision({
      id: "review-1",
      decision: "rejected",
      source: "whatsapp",
      reviewerPhone: null,
    });

    expect(result).toBeNull();
    expect(bumpInboxVersionMock).not.toHaveBeenCalled();
  });
});
