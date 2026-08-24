import { and, asc, eq, inArray, lte, notExists, or, sql } from "drizzle-orm";
import type { MessageJobOrphanReader } from "@/application/ports/message-job-orphan-reader";
import { db } from "@/infrastructure/db/client";
import { inboundEvents, jobs, outboundMessages } from "@/infrastructure/db/schema";

export class DrizzleMessageJobOrphanReader implements MessageJobOrphanReader {
  async listInboundAuthorityCandidates(input: { olderThan: Date; limit: number }) {
    return db
      .select({ id: inboundEvents.id })
      .from(inboundEvents)
      .where(and(
        inArray(inboundEvents.processingStatus, ["pending", "failed"]),
        lte(inboundEvents.receivedAt, input.olderThan),
        or(
          notExists(
            db.select({ id: jobs.id }).from(jobs).where(and(
              eq(jobs.queue, "message.process"),
              eq(
                jobs.dedupeKey,
                sql<string>`'inbound-event:' || ${inboundEvents.id}::text`,
              ),
            )),
          ),
          sql`exists (
            select 1 from jobs bound_job
            where bound_job.id = ${inboundEvents.claimJobId}
              and bound_job.status in ('failed', 'dead', 'done')
          )`,
        ),
      ))
      .orderBy(asc(inboundEvents.receivedAt))
      .limit(input.limit);
  }

  async listOutboundWithoutJob(input: { olderThan: Date; limit: number }) {
    return db
      .select({ id: outboundMessages.id, payload: outboundMessages.payload })
      .from(outboundMessages)
      .where(and(
        eq(outboundMessages.status, "pending"),
        lte(outboundMessages.createdAt, input.olderThan),
        notExists(
          db.select({ id: jobs.id }).from(jobs).where(and(
            eq(jobs.queue, "message.send"),
            eq(
              jobs.dedupeKey,
              sql<string>`'outbound-message:' || ${outboundMessages.id}::text`,
            ),
          )),
        ),
      ))
      .orderBy(asc(outboundMessages.createdAt))
      .limit(input.limit);
  }
}
