import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  update: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({
  db: dbMock,
}));

import { SlotReservationService } from "@/core/scheduling/SlotReservationService";

const clinicId = "clinic-1";
const leadId = "lead-1";
const startsAt = new Date("2026-06-05T20:00:00.000Z");
const endsAt = new Date("2026-06-05T21:00:00.000Z");

function updateChain(returningRows: unknown[] = []) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returningRows),
  };
}

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function insertChain() {
  return {
    values: vi.fn().mockResolvedValue(undefined),
  };
}

describe("SlotReservationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reaproveita reserva released do mesmo horário em vez de retornar slot_taken", async () => {
    const releaseExpired = updateChain();
    const reuseReleased = updateChain([
      {
        id: "reservation-reused",
        clinicId,
        leadId,
        startsAt,
        endsAt,
        status: "pending",
        calendarEventId: null,
        expiresAt: new Date("2026-06-05T20:15:00.000Z"),
      },
    ]);

    dbMock.update
      .mockReturnValueOnce(releaseExpired)
      .mockReturnValueOnce(reuseReleased);
    dbMock.select.mockReturnValueOnce(selectChain([]));

    const service = new SlotReservationService();
    const result = await service.reserve(clinicId, leadId, startsAt, endsAt);

    expect(result?.id).toBe("reservation-reused");
    expect(result?.status).toBe("pending");
    expect(result?.leadId).toBe(leadId);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("insere nova reserva quando não há conflito ativo nem reserva released reutilizável", async () => {
    dbMock.update
      .mockReturnValueOnce(updateChain())
      .mockReturnValueOnce(updateChain([]));
    dbMock.select.mockReturnValueOnce(selectChain([]));
    dbMock.insert.mockReturnValueOnce(insertChain());

    const service = new SlotReservationService();
    const result = await service.reserve(clinicId, leadId, startsAt, endsAt);

    expect(result?.clinicId).toBe(clinicId);
    expect(result?.leadId).toBe(leadId);
    expect(result?.startsAt).toEqual(startsAt);
    expect(result?.status).toBe("pending");
    expect(dbMock.insert).toHaveBeenCalledTimes(1);
  });

  it("bloqueia quando já existe reserva ativa sobreposta", async () => {
    dbMock.update.mockReturnValueOnce(updateChain());
    dbMock.select.mockReturnValueOnce(selectChain([{ id: "active-reservation" }]));

    const service = new SlotReservationService();
    const result = await service.reserve(clinicId, leadId, startsAt, endsAt);

    expect(result).toBeNull();
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });
});
