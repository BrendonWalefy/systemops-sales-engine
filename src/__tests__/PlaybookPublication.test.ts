import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  batch: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({
  db: {
    execute: mocks.execute,
    batch: mocks.batch,
    insert: mocks.insert,
  },
}));

import {
  activateExistingPlaybookVersion,
  publishNewActivePlaybook,
} from "@/application/config/playbook-publication";

describe("playbook publication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ kind: "insert-query" });
  });

  it("ativa versão existente em uma única instrução e exige exatamente um alvo", async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id: "version-1" }] });

    await activateExistingPlaybookVersion({
      clinicId: "clinic-1",
      versionId: "version-1",
      now: new Date("2026-07-26T12:00:00.000Z"),
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("não aceita ativação quando o alvo não pertence à clínica", async () => {
    mocks.execute.mockResolvedValue({ rows: [] });

    await expect(activateExistingPlaybookVersion({
      clinicId: "clinic-1",
      versionId: "other-clinic-version",
    })).rejects.toThrow(/não encontrado/);
  });

  it("arquiva e insere publicação do Advisor no mesmo batch transacional", async () => {
    mocks.execute.mockReturnValue({ kind: "archive-query" });
    mocks.batch.mockResolvedValue([]);

    await publishNewActivePlaybook({
      clinicId: "clinic-1",
      name: "Advisor",
      specialty: "Odontologia",
      commercialPolicy: "Avaliação presencial",
    });

    expect(mocks.batch).toHaveBeenCalledWith([
      { kind: "archive-query" },
      { kind: "insert-query" },
    ]);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: "clinic-1",
      status: "active",
    }));
  });
});
