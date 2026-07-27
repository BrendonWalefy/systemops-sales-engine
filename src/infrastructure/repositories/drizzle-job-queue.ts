import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type {
  ClaimNextJobInput,
  EnqueueJobInput,
  EnqueueJobResult,
  FailJobInput,
  JobQueue,
  JobRecord,
  JobStatus,
} from "@/application/ports/job-queue";
import { db } from "@/infrastructure/db/client";
import { jobs } from "@/infrastructure/db/schema";

export class DrizzleJobQueue implements JobQueue {
  async enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobResult> {
    const [created] = await db
      .insert(jobs)
      .values({
        queue: input.queue,
        payload: input.payload,
        dedupeKey: input.dedupeKey,
        runAt: input.runAt,
        maxAttempts: input.maxAttempts,
      })
      .onConflictDoNothing({ target: [jobs.queue, jobs.dedupeKey] })
      .returning();

    if (created) return { job: mapJob(created), isNew: true };

    if (!input.dedupeKey) {
      throw new Error("Job insert did not return a row without a dedupe key");
    }

    const [existing] = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.queue, input.queue), eq(jobs.dedupeKey, input.dedupeKey)))
      .limit(1);

    if (!existing) {
      throw new Error("Job insert conflicted without an existing job");
    }

    return { job: mapJob(existing), isNew: false };
  }

  async claimNextJob(input: ClaimNextJobInput): Promise<JobRecord | null> {
    if (input.queues.length === 0) return null;

    const now = input.now ?? new Date();
    const candidate = db.$with("claimable_job").as(
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            inArray(jobs.queue, input.queues),
            eq(jobs.status, "pending"),
            lte(jobs.runAt, now),
          ),
        )
        .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
        .limit(1)
        .for("update", { skipLocked: true }),
    );

    // A CTE with SKIP LOCKED and UPDATE runs as one Postgres statement. This is
    // safe with the Neon HTTP driver, which does not keep an interactive lock.
    const [claimed] = await db
      .with(candidate)
      .update(jobs)
      .set({
        status: "processing",
        lockedAt: now,
        lockedBy: input.workerId,
        attempts: sql`${jobs.attempts} + 1`,
        updatedAt: now,
      })
      .from(candidate)
      .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "pending")))
      .returning();

    return claimed ? mapJob(claimed) : null;
  }

  async completeJob(jobId: string, workerId: string, now = new Date()): Promise<boolean> {
    const rows = await db
      .update(jobs)
      .set({
        status: "done",
        lockedAt: null,
        lockedBy: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.status, "processing"),
          eq(jobs.lockedBy, workerId),
        ),
      )
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  async releaseJob(
    jobId: string,
    workerId: string,
    runAt: Date,
    now = new Date(),
  ): Promise<boolean> {
    const rows = await db
      .update(jobs)
      .set({
        status: "pending",
        runAt,
        lockedAt: null,
        lockedBy: null,
        attempts: sql`GREATEST(${jobs.attempts} - 1, 0)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.status, "processing"),
          eq(jobs.lockedBy, workerId),
        ),
      )
      .returning({ id: jobs.id });
    return rows.length > 0;
  }

  async failJob(input: FailJobInput): Promise<JobStatus | null> {
    const now = input.now ?? new Date();
    const terminal = input.job.attempts >= input.job.maxAttempts;
    const [updated] = await db
      .update(jobs)
      .set({
        status: terminal ? "dead" : "pending",
        runAt: terminal ? input.job.runAt : input.retryAt,
        lockedAt: null,
        lockedBy: null,
        lastError: input.error,
        deadLetterDisposition: null,
        deadLetterResolvedAt: null,
        deadLetterResolvedBy: null,
        deadLetterResolutionReason: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(jobs.id, input.job.id),
          eq(jobs.status, "processing"),
          eq(jobs.lockedBy, input.workerId),
        ),
      )
      .returning({ status: jobs.status });
    return updated?.status ?? null;
  }

  async recoverStaleJobs(input: { olderThan: Date }): Promise<number> {
    const rows = await db
      .update(jobs)
      .set({
        status: "pending",
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.status, "processing"), lt(jobs.lockedAt, input.olderThan)))
      .returning({ id: jobs.id });
    return rows.length;
  }
}

function mapJob(row: typeof jobs.$inferSelect): JobRecord {
  return {
    id: row.id,
    queue: row.queue,
    status: row.status,
    payload: row.payload,
    dedupeKey: row.dedupeKey,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAt: row.runAt,
    lockedAt: row.lockedAt,
    lockedBy: row.lockedBy,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
