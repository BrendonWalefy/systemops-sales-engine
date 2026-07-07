// resolveMediaLibraryForVersion é a FONTE ÚNICA de leitura da biblioteca de
// mídia (ver docs/product/biblioteca-midia-plano.md): lê media_asset_ids da
// tabela clinic-level media_assets, com fallback ao jsonb legado enquanto uma
// versão não foi migrada. Cobre também o isolamento por tenant do repositório.
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
      mediaLibrary: [], // legado vazio — não deveria nem ser consultado
    });

    expect(result).toEqual([{ id: "a1", title: "Lentes", url: "https://blob/lentes.mp4", type: "video", treatmentId: null }]);
    expect(mocks.findByIds).toHaveBeenCalledWith(CLINIC_ID, ["a1"]);
  });

  it("passa o clinicId da SESSÃO para o repositório — nunca confia em id sozinho (isolamento por tenant)", async () => {
    mocks.findByIds.mockResolvedValue([]);
    await resolveMediaLibraryForVersion("clinic-outra", { id: "v1", mediaAssetIds: ["asset-de-outra-clinica"], mediaLibrary: [] });
    expect(mocks.findByIds).toHaveBeenCalledWith("clinic-outra", ["asset-de-outra-clinica"]);
  });

  it("cai no jsonb legado quando media_asset_ids está vazio mas media_library tem itens (versão não migrada)", async () => {
    const result = await resolveMediaLibraryForVersion(CLINIC_ID, {
      id: "version-antiga",
      mediaAssetIds: [],
      mediaLibrary: [{ id: "legacy-1", title: "Vídeo antigo", url: "https://blob/old.mp4", type: "video" }],
    });

    expect(result).toEqual([{ id: "legacy-1", title: "Vídeo antigo", url: "https://blob/old.mp4", type: "video", treatmentId: null }]);
    expect(mocks.findByIds).not.toHaveBeenCalled();
  });

  it("retorna lista vazia quando não há mídia em nenhuma das duas fontes", async () => {
    const result = await resolveMediaLibraryForVersion(CLINIC_ID, { id: "v-vazia", mediaAssetIds: [], mediaLibrary: [] });
    expect(result).toEqual([]);
  });
});
