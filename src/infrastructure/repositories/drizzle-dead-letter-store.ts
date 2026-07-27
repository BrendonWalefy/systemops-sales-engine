import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  validateDeadLetterResolution,
  type DeadLetterAction,
} from "@/application/jobs/manage-dead-letters";
import { db } from "@/infrastructure/db/client";
import {
  jobDeadLetterActions,
  jobs,
  outboundMessages,
} from "@/infrastructure/db/schema";

export type DeadLetterListItem = {
  id: string;
  queue: "message.process" | "message.send" | "followup.dispatch";
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  disposition: "acknowledged" | "discarded" | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionReason: string | null;
  outboundStatus: string | null;
};

export class DrizzleDeadLetterStore {
  async list(input: { includeResolved?: boolean; limit?: number } = {}): Promise<DeadLetterListItem[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
    const rows = await db
      .select({
        id: jobs.id,
        queue: jobs.queue,
        payload: jobs.payload,
        attempts: jobs.attempts,
        maxAttempts: jobs.maxAttempts,
        lastError: jobs.lastError,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        disposition: jobs.deadLetterDisposition,
        resolvedAt: jobs.deadLetterResolvedAt,
        resolvedBy: jobs.deadLetterResolvedBy,
        resolutionReason: jobs.deadLetterResolutionReason,
        outboundStatus: outboundMessages.status,
      })
      .from(jobs)
      .leftJoin(
        outboundMessages,
        eq(
          outboundMessages.id,
          sql`nullif(${jobs.payload}->>'outboundMessageId', '')::uuid`,
        ),
      )
      .where(
        input.includeResolved
          ? eq(jobs.status, "dead")
          : and(eq(jobs.status, "dead"), isNull(jobs.deadLetterDisposition)),
      )
      .orderBy(desc(jobs.updatedAt))
      .limit(limit);
    return rows;
  }

  async resolve(input: {
    jobId: string;
    action: DeadLetterAction;
    actorEmail: string;
    reason: string;
    allowLateDelivery?: boolean;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const [candidate] = await db
      .select({
        id: jobs.id,
        queue: jobs.queue,
        status: jobs.status,
        createdAt: jobs.createdAt,
        resolved: sql<boolean>`${jobs.deadLetterDisposition} is not null`,
        outboundId: outboundMessages.id,
        outboundStatus: outboundMessages.status,
        attempts: jobs.attempts,
        lastError: jobs.lastError,
      })
      .from(jobs)
      .leftJoin(
        outboundMessages,
        eq(
          outboundMessages.id,
          sql`nullif(${jobs.payload}->>'outboundMessageId', '')::uuid`,
        ),
      )
      .where(eq(jobs.id, input.jobId))
      .limit(1);

    if (!candidate) throw new Error("Dead letter não encontrado.");
    validateDeadLetterResolution(candidate, { ...input, now });

    const disposition = input.action === "acknowledge"
      ? "acknowledged"
      : input.action === "discard"
        ? "discarded"
        : null;
    const auditStatement = db.insert(jobDeadLetterActions).values({
        jobId: candidate.id,
        action: input.action,
        actorEmail: input.actorEmail,
        reason: input.reason.trim(),
        allowedLateDelivery: input.allowLateDelivery ?? false,
        jobAttempts: candidate.attempts,
        jobLastError: candidate.lastError,
        createdAt: now,
      });
    const jobStatement = db
        .update(jobs)
        .set(
          input.action === "reprocess"
            ? {
                status: "pending" as const,
                attempts: 0,
                runAt: now,
                lockedAt: null,
                lockedBy: null,
                lastError: null,
                deadLetterDisposition: null,
                deadLetterResolvedAt: null,
                deadLetterResolvedBy: null,
                deadLetterResolutionReason: null,
                updatedAt: now,
              }
            : {
                deadLetterDisposition: disposition,
                deadLetterResolvedAt: now,
                deadLetterResolvedBy: input.actorEmail,
                deadLetterResolutionReason: input.reason.trim(),
                updatedAt: now,
              },
        )
        .where(
          and(
            eq(jobs.id, candidate.id),
            eq(jobs.status, "dead"),
            isNull(jobs.deadLetterDisposition),
          ),
        );

    if (input.action === "reprocess" && candidate.outboundId) {
      const outboundStatement = db
        .update(outboundMessages)
        .set({ status: "pending", lastError: null })
        .where(
          and(
            eq(outboundMessages.id, candidate.outboundId),
            eq(outboundMessages.status, "dead"),
          ),
        );
      await db.batch([auditStatement, jobStatement, outboundStatement]);
      return;
    }

    await db.batch([auditStatement, jobStatement]);
  }
}
