import { and, eq, ilike } from "drizzle-orm";
import type { PipelineStep, Treatment, TreatmentQuantityPrice, TreatmentBookingWindow } from "@/domain/entities/treatment";
import type { TreatmentRepository } from "@/domain/repositories/treatment-repository";
import { db } from "@/infrastructure/db/client";
import { treatments } from "@/infrastructure/db/schema";

export class DrizzleTreatmentRepository implements TreatmentRepository {
  async listByClinic(clinicId: string): Promise<Treatment[]> {
    const rows = await db.query.treatments.findMany({
      where: eq(treatments.clinicId, clinicId),
      orderBy: treatments.name,
    });
    return rows.map(mapRow);
  }

  async findByName(clinicId: string, name: string): Promise<Treatment | null> {
    const row = await db.query.treatments.findFirst({
      where: and(eq(treatments.clinicId, clinicId), ilike(treatments.name, name)),
    });
    return row ? mapRow(row) : null;
  }

  async create(data: Omit<Treatment, "id" | "createdAt" | "updatedAt">): Promise<Treatment> {
    const [row] = await db
      .insert(treatments)
      .values({
        clinicId: data.clinicId,
        name: data.name,
        durationMinutes: data.durationMinutes,
        description: data.description,
        requiresEvaluationFirst: data.requiresEvaluationFirst,
        keywordMatchEnabled: data.keywordMatchEnabled,
        aliases: data.aliases,
        isAesthetic: data.isAesthetic,
        pipelineSteps: data.pipelineSteps ?? null,
        priceCents: data.priceCents ?? null,
        minPriceCents: data.minPriceCents ?? null,
        maxPriceCents: data.maxPriceCents ?? null,
        priceQuotableInChat: data.priceQuotableInChat,
        priceKind: data.priceKind,
        priceUnit: data.priceUnit ?? null,
        priceDeductible: data.priceDeductible,
        quantityPrices: data.quantityPrices ?? null,
        bookingWindows: data.bookingWindows ?? null,
      })
      .returning();
    return mapRow(row);
  }

  async update(
    id: string,
    data: Partial<Pick<Treatment, "name" | "durationMinutes" | "description" | "requiresEvaluationFirst" | "keywordMatchEnabled" | "aliases" | "isAesthetic" | "pipelineSteps" | "priceCents" | "minPriceCents" | "maxPriceCents" | "priceQuotableInChat" | "priceKind" | "priceUnit" | "priceDeductible" | "quantityPrices" | "bookingWindows">>,
  ): Promise<Treatment> {
    const [row] = await db
      .update(treatments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(treatments.id, id))
      .returning();
    return mapRow(row);
  }

  async delete(id: string): Promise<void> {
    await db.delete(treatments).where(eq(treatments.id, id));
  }
}

function mapRow(row: typeof treatments.$inferSelect): Treatment {
  return {
    id: row.id,
    clinicId: row.clinicId,
    name: row.name,
    durationMinutes: row.durationMinutes,
    description: row.description,
    requiresEvaluationFirst: row.requiresEvaluationFirst,
    keywordMatchEnabled: row.keywordMatchEnabled,
    aliases: row.aliases as string[],
    isAesthetic: row.isAesthetic,
    pipelineSteps: (row.pipelineSteps as PipelineStep[] | null) ?? null,
    priceCents: row.priceCents ?? null,
    minPriceCents: row.minPriceCents ?? null,
    maxPriceCents: row.maxPriceCents ?? null,
    priceQuotableInChat: row.priceQuotableInChat,
    priceKind: row.priceKind,
    priceUnit: row.priceUnit ?? null,
    priceDeductible: row.priceDeductible,
    quantityPrices: (row.quantityPrices as TreatmentQuantityPrice[] | null) ?? null,
    bookingWindows: (row.bookingWindows as TreatmentBookingWindow[] | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
