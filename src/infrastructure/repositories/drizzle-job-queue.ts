import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type {
  ClaimInboundWorkResult,
  ClaimNextInboundWorkInput,
  ClaimNextJobInput,
  EnqueueJobInput,
  EnqueueJobResult,
  FailJobInput,
  JobQueue,
  JobRecord,
  JobStatus,
} from "@/application/ports/job-queue";
import {
  digestInboundClaimToken,
  generateInboundClaimToken,
} from "@/application/jobs/inbound-claim-token";
import { db } from "@/infrastructure/db/client";
import { jobs } from "@/infrastructure/db/schema";

type ClaimedInboundRow = {
  outcome: "claimed" | "history_only";
  stream_id: string;
  stream_generation: number | string;
  inbound_event_id: string;
  claim_token: string | null;
  job_id: string;
  job_queue: JobRecord["queue"];
  job_status: JobRecord["status"];
  job_payload: unknown;
  job_dedupe_key: string | null;
  job_attempts: number;
  job_max_attempts: number;
  job_run_at: Date | string;
  job_locked_at: Date | string | null;
  job_locked_by: string | null;
  job_last_error: string | null;
  job_created_at: Date | string;
  job_updated_at: Date | string;
};

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

  async claimNextInboundWork(
    input: ClaimNextInboundWorkInput,
  ): Promise<ClaimInboundWorkResult | null> {
    const now = input.now ?? new Date();
    const generatedToken = generateInboundClaimToken();
    const generatedDigest = digestInboundClaimToken(generatedToken);
    const result = await db.execute<ClaimedInboundRow>(sql`
      with candidate as materialized (
        select
          job.id as job_id,
          event.id as inbound_event_id,
          event.stream_id,
          event.stream_generation,
          case
            when event.claim_token is not null then 'claimed'
            when event.processing_status = 'history_only'
              or stream.state <> 'active'
              or stream.latest_inbound_event_id is distinct from event.id
              or stream.current_generation is distinct from event.stream_generation
              then 'history_only'
            else 'claimed'
          end as outcome
        from jobs job
        join inbound_events event
          on event.id = job.inbound_event_id
        join whatsapp_streams stream
          on stream.id = event.stream_id
         and stream.organization_id = event.organization_id
        where job.queue = 'message.process'
          and job.status = 'pending'
          and job.run_at <= ${now}
          and (${input.dedupeKey ?? null}::text is null or job.dedupe_key = ${input.dedupeKey ?? null})
          and job.dedupe_key = 'inbound-event:' || event.id::text
          and job.payload->>'inboundEventId' = event.id::text
          and job.payload->>'streamId' = event.stream_id::text
          and job.payload->>'streamGeneration' = event.stream_generation::text
          and event.stream_id is not null
          and event.stream_generation is not null
          and event.processing_status in ('pending', 'processing', 'failed', 'history_only')
          and (
            (
              event.claim_token is not null
              and event.claim_job_id = job.id
            )
            or
            (
              event.claim_token is null
              and event.claim_job_id is null
              and (
                event.processing_status = 'history_only'
                or stream.state <> 'active'
                or stream.latest_inbound_event_id is distinct from event.id
                or stream.current_generation is distinct from event.stream_generation
                or (
                  stream.state = 'active'
                  and stream.latest_inbound_event_id = event.id
                  and stream.current_generation = event.stream_generation
                  and stream.quiet_until <= ${now}
                )
              )
            )
          )
        order by job.run_at, job.created_at, job.id
        limit 1
        for update of job, event, stream skip locked
      ),
      updated_job as (
        update jobs job
        set
          status = 'processing',
          locked_at = ${now},
          locked_by = ${input.workerId},
          attempts = job.attempts + 1,
          updated_at = ${now}
        from candidate
        where job.id = candidate.job_id
          and job.status = 'pending'
        returning job.*
      ),
      updated_event as (
        update inbound_events event
        set
          processing_status = case
            when candidate.outcome = 'history_only'
              then 'history_only'::inbound_event_processing_status
            else 'processing'::inbound_event_processing_status
          end,
          claim_token = case
            when candidate.outcome = 'claimed'
              then coalesce(event.claim_token, ${generatedToken})
            else event.claim_token
          end,
          claim_token_digest = case
            when candidate.outcome = 'claimed'
              then coalesce(event.claim_token_digest, ${generatedDigest})
            else event.claim_token_digest
          end,
          claim_job_id = case
            when candidate.outcome = 'claimed'
              then coalesce(event.claim_job_id, candidate.job_id)
            else event.claim_job_id
          end,
          claimed_at = case
            when candidate.outcome = 'claimed'
              then coalesce(event.claimed_at, ${now})
            else event.claimed_at
          end
        from candidate
        where event.id = candidate.inbound_event_id
        returning event.*
      )
      select
        candidate.outcome,
        candidate.stream_id::text,
        candidate.stream_generation,
        candidate.inbound_event_id::text,
        updated_event.claim_token,
        updated_job.id::text as job_id,
        updated_job.queue as job_queue,
        updated_job.status as job_status,
        updated_job.payload as job_payload,
        updated_job.dedupe_key as job_dedupe_key,
        updated_job.attempts as job_attempts,
        updated_job.max_attempts as job_max_attempts,
        updated_job.run_at as job_run_at,
        updated_job.locked_at as job_locked_at,
        updated_job.locked_by as job_locked_by,
        updated_job.last_error as job_last_error,
        updated_job.created_at as job_created_at,
        updated_job.updated_at as job_updated_at
      from candidate
      join updated_job on updated_job.id = candidate.job_id
      join updated_event on updated_event.id = candidate.inbound_event_id
    `);
    const row = result.rows[0];
    if (!row) return null;
    return {
      outcome: row.outcome,
      streamId: row.stream_id,
      streamGeneration: Number(row.stream_generation),
      inboundEventId: row.inbound_event_id,
      claimToken: row.claim_token,
      job: {
        id: row.job_id,
        queue: row.job_queue,
        status: row.job_status,
        payload: row.job_payload,
        dedupeKey: row.job_dedupe_key,
        attempts: row.job_attempts,
        maxAttempts: row.job_max_attempts,
        runAt: new Date(row.job_run_at),
        lockedAt: row.job_locked_at ? new Date(row.job_locked_at) : null,
        lockedBy: row.job_locked_by,
        lastError: row.job_last_error,
        createdAt: new Date(row.job_created_at),
        updatedAt: new Date(row.job_updated_at),
      },
    };
  }

  async claimNextJob(input: ClaimNextJobInput): Promise<JobRecord | null> {
    const queues = input.queues.filter((queue) => queue !== "message.process");
    if (queues.length === 0) return null;

    const now = input.now ?? new Date();
    const candidate = db.$with("claimable_job").as(
      db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            inArray(jobs.queue, queues),
            input.dedupeKey === undefined
              ? undefined
              : eq(jobs.dedupeKey, input.dedupeKey),
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
