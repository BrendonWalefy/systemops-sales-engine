import { and, eq } from "drizzle-orm";
import type { Professional } from "@/domain/entities/professional";
import type { ProfessionalRepository } from "@/domain/repositories/professional-repository";
import { db } from "@/infrastructure/db/client";
import { professionals } from "@/infrastructure/db/schema";

export class DrizzleProfessionalRepository implements ProfessionalRepository {
  async listByClinic(clinicId: string): Promise<Professional[]> {
    const rows = await db.query.professionals.findMany({
      where: eq(professionals.clinicId, clinicId),
      orderBy: professionals.name,
    });
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<Professional | null> {
    const row = await db.query.professionals.findFirst({
      where: eq(professionals.id, id),
    });
    return row ? mapRow(row) : null;
  }

  async create(data: Omit<Professional, "id" | "createdAt" | "updatedAt">): Promise<Professional> {
    const [row] = await db
      .insert(professionals)
      .values({
        clinicId: data.clinicId,
        name: data.name,
        specialty: data.specialty,
        color: data.color,
        workSchedule: data.workSchedule,
        googleCalendarId: data.googleCalendarId,
        isActive: data.isActive,
      })
      .returning();
    return mapRow(row);
  }

  async update(
    id: string,
    clinicId: string,
    data: Partial<Pick<Professional, "name" | "specialty" | "color" | "workSchedule" | "googleCalendarId" | "isActive">>,
  ): Promise<Professional | null> {
    const [row] = await db
      .update(professionals)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(professionals.id, id), eq(professionals.clinicId, clinicId)))
      .returning();
    return row ? mapRow(row) : null;
  }

  async delete(id: string, clinicId: string): Promise<void> {
    await db.delete(professionals).where(and(eq(professionals.id, id), eq(professionals.clinicId, clinicId)));
  }
}

function mapRow(row: typeof professionals.$inferSelect): Professional {
  return {
    id: row.id,
    clinicId: row.clinicId,
    name: row.name,
    specialty: row.specialty,
    color: row.color,
    workSchedule: row.workSchedule,
    googleCalendarId: row.googleCalendarId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
