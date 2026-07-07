import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { MediaAsset, MediaAssetUsage } from "@/domain/entities/media-asset";
import type {
  CreateMediaAssetInput,
  MediaAssetRepository,
  UpdateMediaAssetInput,
} from "@/domain/repositories/media-asset-repository";
import { db } from "@/infrastructure/db/client";
import { mediaAssets, playbookVersions, treatments } from "@/infrastructure/db/schema";

export class DrizzleMediaAssetRepository implements MediaAssetRepository {
  async listByClinic(clinicId: string): Promise<MediaAsset[]> {
    const rows = await db.query.mediaAssets.findMany({
      where: eq(mediaAssets.clinicId, clinicId),
      orderBy: asc(mediaAssets.createdAt),
    });
    return rows.map(mapRow);
  }

  async listByClinicAndTreatment(
    clinicId: string,
    treatmentId: string | null,
  ): Promise<MediaAsset[]> {
    const rows = await db.query.mediaAssets.findMany({
      where: and(
        eq(mediaAssets.clinicId, clinicId),
        treatmentId
          ? or(isNull(mediaAssets.treatmentId), eq(mediaAssets.treatmentId, treatmentId))
          : isNull(mediaAssets.treatmentId),
      ),
      orderBy: asc(mediaAssets.createdAt),
    });
    return rows.map(mapRow);
  }

  async findByIds(clinicId: string, ids: string[]): Promise<MediaAsset[]> {
    if (ids.length === 0) return [];
    const rows = await db.query.mediaAssets.findMany({
      where: and(eq(mediaAssets.clinicId, clinicId), inArray(mediaAssets.id, ids)),
    });
    return rows.map(mapRow);
  }

  async findById(clinicId: string, id: string): Promise<MediaAsset | null> {
    const row = await db.query.mediaAssets.findFirst({
      where: and(eq(mediaAssets.clinicId, clinicId), eq(mediaAssets.id, id)),
    });
    return row ? mapRow(row) : null;
  }

  async countByClinic(clinicId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(mediaAssets)
      .where(eq(mediaAssets.clinicId, clinicId));
    return row?.count ?? 0;
  }

  async create(data: CreateMediaAssetInput): Promise<MediaAsset> {
    const [row] = await db
      .insert(mediaAssets)
      .values({
        clinicId: data.clinicId,
        treatmentId: data.treatmentId ?? null,
        title: data.title,
        url: data.url,
        type: data.type,
        mimeType: data.mimeType ?? null,
        sizeBytes: data.sizeBytes ?? null,
        folder: data.folder ?? null,
      })
      .returning();
    return mapRow(row);
  }

  async update(
    id: string,
    clinicId: string,
    data: UpdateMediaAssetInput,
  ): Promise<MediaAsset | null> {
    const [row] = await db
      .update(mediaAssets)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.clinicId, clinicId)))
      .returning();
    return row ? mapRow(row) : null;
  }

  async delete(id: string, clinicId: string): Promise<void> {
    await db.delete(mediaAssets).where(and(eq(mediaAssets.id, id), eq(mediaAssets.clinicId, clinicId)));
  }

  async findUsage(id: string, clinicId: string): Promise<MediaAssetUsage> {
    const [versionRows, treatmentRows] = await Promise.all([
      db
        .select({ id: playbookVersions.id, name: playbookVersions.name })
        .from(playbookVersions)
        .where(
          and(
            eq(playbookVersions.clinicId, clinicId),
            sql`${playbookVersions.mediaAssetIds} @> ${JSON.stringify([id])}::jsonb`,
          ),
        ),
      // pipeline_steps é jsonb livre (ContentBlock[] dentro de PipelineStep[]); a
      // guarda de exclusão faz um LIKE textual no id — suficiente para uma ação de
      // baixa frequência (confirmação de delete), sem exigir índice dedicado.
      db
        .select({ id: treatments.id, name: treatments.name })
        .from(treatments)
        .where(
          and(
            eq(treatments.clinicId, clinicId),
            sql`${treatments.pipelineSteps}::text LIKE ${`%"mediaId":"${id}"%`}`,
          ),
        ),
    ]);

    return { playbookVersions: versionRows, treatments: treatmentRows };
  }
}

function mapRow(row: typeof mediaAssets.$inferSelect): MediaAsset {
  return {
    id: row.id,
    clinicId: row.clinicId,
    treatmentId: row.treatmentId,
    title: row.title,
    url: row.url,
    type: row.type,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    folder: row.folder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
