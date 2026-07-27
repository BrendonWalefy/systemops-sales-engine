// resolveMediaLibraryForVersion é a FONTE ÚNICA de leitura da biblioteca de
// mídia (ver docs/product/biblioteca-midia-plano.md): lê media_asset_ids da
// tabela clinic-level media_assets. Cobre também o isolamento por tenant.
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findByIds: vi.fn(),
}));

vi.mock("@/infrastructure/repositories/drizzle-media-asset-repository", () => ({
  DrizzleMediaAssetRepository: vi.fn().mockImplementation(() => ({
    findByIds: mocks.findByIds,
  })),
}));

import { resolveMediaLibraryForVersion } from "@/application/config/editorial-config";

const CLINIC_ID = "clinic-ximendes";

describe("resolveMediaLibraryForVersion", () => {
  beforeEach(() => {
    mocks.findByIds.mockReset();
  });

  it("lê da tabela media_assets quando media_asset_ids está populado (fluxo pós-migração)", async () => {
    mocks.findByIds.mockResolvedValue([
      { id: "a1", clinicId: CLINIC_ID, treatmentId: null, title: "Lentes", url: "https://blob/lentes.mp4", type: "video", mimeType: null, sizeBytes: null, folder: null, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await resolveMediaLibraryForVersion(CLINIC_ID, {
      id: "version-1",
      mediaAssetIds: ["a1"],
    });

    expect(result).toEqual([{ id: "a1", title: "Lentes", url: "https://blob/lentes.mp4", type: "video", treatmentId: null }]);
    expect(mocks.findByIds).toHaveBeenCalledWith(CLINIC_ID, ["a1"]);
  });

  it("passa o clinicId da SESSÃO para o repositório — nunca confia em id sozinho (isolamento por tenant)", async () => {
    mocks.findByIds.mockResolvedValue([]);
    await resolveMediaLibraryForVersion("clinic-outra", { id: "v1", mediaAssetIds: ["asset-de-outra-clinica"] });
    expect(mocks.findByIds).toHaveBeenCalledWith("clinic-outra", ["asset-de-outra-clinica"]);
  });

  it("retorna lista vazia quando a versão não seleciona mídia", async () => {
    const result = await resolveMediaLibraryForVersion(CLINIC_ID, { id: "v-vazia", mediaAssetIds: [] });
    expect(result).toEqual([]);
    expect(mocks.findByIds).not.toHaveBeenCalled();
  });
});
