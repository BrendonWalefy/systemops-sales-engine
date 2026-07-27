import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { DecisionTraceRecord } from "@/core/observability/DecisionTrace";
import { db } from "@/infrastructure/db/client";
import { decisionTraces } from "@/infrastructure/db/schema";

export type AppendDecisionTraceBatchInput = {
  turnId: string;
  clinicId: string;
  conversationId: string | null;
  events: DecisionTraceRecord[];
  expiresAt: Date;
};

export type DecisionTraceBatchStore = {
  append(input: AppendDecisionTraceBatchInput): Promise<void>;
};

export class DrizzleDecisionTraceStore implements DecisionTraceBatchStore {
  async append(input: AppendDecisionTraceBatchInput): Promise<void> {
    if (input.events.length === 0) return;
    const firstOccurredAt = new Date(input.events[0]!.occurredAt);
    const lastOccurredAt = new Date(input.events.at(-1)!.occurredAt);
    const now = new Date();
    const serializedEvents = JSON.stringify(input.events);

    await db
      .insert(decisionTraces)
      .values({
        turnId: input.turnId,
        clinicId: input.clinicId,
        conversationId: input.conversationId,
        events: input.events,
        firstOccurredAt,
        lastOccurredAt,
        expiresAt: input.expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: decisionTraces.turnId,
        set: {
          conversationId: sql`COALESCE(excluded.conversation_id, ${decisionTraces.conversationId})`,
          events: sql`${decisionTraces.events} || ${serializedEvents}::jsonb`,
          lastOccurredAt,
          expiresAt: input.expiresAt,
          updatedAt: now,
        },
      });
  }

  async listByConversation(
    clinicId: string,
    conversationId: string,
    limit = 100,
  ): Promise<Array<typeof decisionTraces.$inferSelect>> {
    return db
      .select()
      .from(decisionTraces)
      .where(and(
        eq(decisionTraces.clinicId, clinicId),
        eq(decisionTraces.conversationId, conversationId),
      ))
      .orderBy(desc(decisionTraces.updatedAt))
      .limit(limit);
  }

  async deleteExpired(now: Date, limit = 1_000): Promise<number> {
    const expired = await db
      .select({ turnId: decisionTraces.turnId })
      .from(decisionTraces)
      .where(lt(decisionTraces.expiresAt, now))
      .limit(limit);
    if (expired.length === 0) return 0;
    const deleted = await db
      .delete(decisionTraces)
      .where(inArray(decisionTraces.turnId, expired.map((row) => row.turnId)))
      .returning({ turnId: decisionTraces.turnId });
    return deleted.length;
  }
}
