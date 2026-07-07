import type { MediaAsset, MediaAssetType, MediaAssetUsage } from "../entities/media-asset";

export type CreateMediaAssetInput = {
  clinicId: string;
  treatmentId?: string | null;
  title: string;
  url: string;
  type: MediaAssetType;
  mimeType?: string | null;
  sizeBytes?: number | null;
  folder?: string | null;
};

export type UpdateMediaAssetInput = Partial<
  Pick<MediaAsset, "title" | "folder" | "treatmentId">
>;

export type MediaAssetRepository = {
  /** Lista TODA a biblioteca da clínica — usado pela tela de biblioteca. */
  listByClinic(clinicId: string): Promise<MediaAsset[]>;
  /**
   * Lista os assets utilizáveis por um procedimento: os dele + os gerais
   * (treatmentId null). Isolamento entre procedimentos aplicado na query.
   */
  listByClinicAndTreatment(clinicId: string, treatmentId: string | null): Promise<MediaAsset[]>;
  /** Busca em lote, filtrando SEMPRE por clinicId — nunca confia no id sozinho. */
  findByIds(clinicId: string, ids: string[]): Promise<MediaAsset[]>;
  findById(clinicId: string, id: string): Promise<MediaAsset | null>;
  countByClinic(clinicId: string): Promise<number>;
  create(data: CreateMediaAssetInput): Promise<MediaAsset>;
  /** Tenant-scoped: só atualiza se o asset pertencer a clinicId. */
  update(id: string, clinicId: string, data: UpdateMediaAssetInput): Promise<MediaAsset | null>;
  /** Tenant-scoped: só apaga se o asset pertencer a clinicId. */
  delete(id: string, clinicId: string): Promise<void>;
  /** Onde este asset está referenciado — guarda de exclusão. */
  findUsage(id: string, clinicId: string): Promise<MediaAssetUsage>;
};
