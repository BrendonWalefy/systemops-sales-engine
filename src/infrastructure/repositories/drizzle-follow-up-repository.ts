import { and, asc, desc, eq, lt, lte } from "drizzle-orm";
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

  async findPendingByReason(input: { leadId: string; reason: string }): Promise<FollowUp | null> {
    const rows = await db
      .select()
      .from(followUps)
      .where(and(eq(followUps.leadId, input.leadId), eq(followUps.reason, input.reason), eq(followUps.status, "pending")))
      .orderBy(desc(followUps.createdAt))
      .limit(1);
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async listPendingByLead(input: { leadId: string }): Promise<FollowUp[]> {
    const rows = await db
      .select()
      .from(followUps)
      .where(and(eq(followUps.leadId, input.leadId), eq(followUps.status, "pending")))
      .orderBy(asc(followUps.dueAt), asc(followUps.createdAt));
    return rows.map(mapRow);
  }

  async cancelPendingByReason(input: { leadId: string; reason: string }): Promise<number> {
    const rows = await db
      .update(followUps)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(followUps.leadId, input.leadId),
          eq(followUps.reason, input.reason),
          eq(followUps.status, "pending"),
        ),
      )
      .returning({ id: followUps.id });
    return rows.length;
  }

  async cancelPendingByLead(input: { leadId: string }): Promise<number> {
    const rows = await db
      .update(followUps)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(followUps.leadId, input.leadId), eq(followUps.status, "pending")))
      .returning({ id: followUps.id });
    return rows.length;
  }

  async listDue(input: { clinicId: string; now: Date }): Promise<FollowUp[]> {
    const rows = await db
      .select()
      .from(followUps)
      .where(
        and(
        eq(followUps.clinicId, input.clinicId),
        eq(followUps.status, "pending"),
        lte(followUps.dueAt, input.now),
        ),
      )
      .orderBy(asc(followUps.dueAt), asc(followUps.createdAt));
    return rows.map(mapRow);
  }

  // CAS de single-statement: só um run do dispatcher consegue a transição
  // pending → sending. Atômico no Postgres mesmo com neon-http.
  async claimForSending(id: string): Promise<boolean> {
    const rows = await db
      .update(followUps)
      .set({ status: "sending", updatedAt: new Date() })
      .where(and(eq(followUps.id, id), eq(followUps.status, "pending")))
      .returning({ id: followUps.id });
    return rows.length > 0;
  }

  async recoverStaleSending(input: { clinicId: string; olderThan: Date }): Promise<number> {
    const rows = await db
      .update(followUps)
      .set({ status: "pending", updatedAt: new Date() })
      .where(
        and(
          eq(followUps.clinicId, input.clinicId),
          eq(followUps.status, "sending"),
          lt(followUps.updatedAt, input.olderThan),
        ),
      )
      .returning({ id: followUps.id });
    return rows.length;
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
