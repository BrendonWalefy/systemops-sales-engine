export type MediaAssetType = "video" | "image" | "document";

export type MediaAsset = {
  id: string;
  clinicId: string;
  treatmentId: string | null;
  title: string;
  url: string;
  type: MediaAssetType;
  mimeType: string | null;
  sizeBytes: number | null;
  folder: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Onde um asset está referenciado — usado pela guarda de exclusão. */
export type MediaAssetUsage = {
  playbookVersions: { id: string; name: string }[];
  treatments: { id: string; name: string }[];
};
