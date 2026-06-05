import { and, eq, lte } from "drizzle-orm";
import type { FollowUp } from "@/domain/entities/follow-up";
import type { FollowUpRepository } from "@/domain/repositories/follow-up-repository";
import { db } from "@/infrastructure/db/client";
import { followUps } from "@/infrastructure/db/schema";

export class DrizzleFollowUpRepository implements FollowUpRepository {
  async save(followUp: FollowUp): Promise<void> {
    await db
      .insert(followUps)
      .values({
        id: followUp.id,
        clinicId: followUp.clinicId,
        leadId: followUp.leadId,
        dueAt: followUp.dueAt,
        status: followUp.status,
        reason: followUp.reason,
        suggestedMessage: followUp.suggestedMessage,
        completedAt: followUp.completedAt,
        createdAt: followUp.createdAt,
        updatedAt: followUp.updatedAt,
      })
      .onConflictDoUpdate({
        target: [followUps.clinicId, followUps.leadId, followUps.reason, followUps.dueAt],
        set: {
          status: followUp.status,
          suggestedMessage: followUp.suggestedMessage,
          completedAt: followUp.completedAt,
          updatedAt: followUp.updatedAt,
        },
      });
  }

  async listDue(input: { clinicId: string; now: Date }): Promise<FollowUp[]> {
    const rows = await db.query.followUps.findMany({
      where: and(
        eq(followUps.clinicId, input.clinicId),
        eq(followUps.status, "pending"),
        lte(followUps.dueAt, input.now),
      ),
    });
    return rows.map(mapRow);
  }
}

function mapRow(row: typeof followUps.$inferSelect): FollowUp {
  return {
    id: row.id,
    clinicId: row.clinicId,
    leadId: row.leadId,
    dueAt: row.dueAt,
    status: row.status,
    reason: row.reason,
    suggestedMessage: row.suggestedMessage,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
