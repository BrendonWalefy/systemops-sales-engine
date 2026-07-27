import { and, count, eq, gte, isNotNull, isNull, lt, lte, min } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { jobs } from "@/infrastructure/db/schema";
import type { JobQueueName } from "@/application/ports/job-queue";
import type { OperationalAlert } from "@/application/health/operational-alerts";

const STALLED_PENDING_AFTER_MS = 10 * 60_000;
const STALE_PROCESSING_AFTER_MS = 5 * 60_000;
const REPEATED_FAILURE_ATTEMPTS = 3;

export type QueueHealthAlert = {
  queue: JobQueueName;
  kind: "dead_jobs" | "stalled_pending" | "stale_processing" | "repeated_failures";
  level: "warn" | "critical";
  count: number;
  oldestAt?: Date | null;
};

export type QueueHealthReport = {
  checkedAt: Date;
  alerts: QueueHealthAlert[];
};

export function mapQueueHealthAlertsToOperationalAlerts(
  alerts: QueueHealthAlert[],
): OperationalAlert[] {
  return alerts.map((alert) => ({
    clinicId: "platform",
    clinicName: "Plataforma",
    source: "queue",
    level: alert.level,
    title: alert.kind === "dead_jobs"
      ? "Jobs mortos na fila"
      : alert.kind === "stalled_pending"
        ? "Fila parada"
        : alert.kind === "stale_processing"
          ? "Worker interrompido"
          : "Falhas repetidas na fila",
    detail: `${alert.queue}: ${alert.count} job(s)${alert.oldestAt ? `; mais antigo desde ${alert.oldestAt.toISOString()}` : ""}`,
  }));
}

type QueueCount = { queue: JobQueueName; count: number };
type QueueOldest = QueueCount & { oldestAt: Date | null };

export function evaluateQueueHealth(
  snapshot: {
    dead: QueueCount[];
    stalledPending: QueueOldest[];
    staleProcessing: QueueOldest[];
    repeatedFailures: QueueCount[];
  },
  now: Date,
): QueueHealthReport {
  const alerts: QueueHealthAlert[] = [];

  snapshot.dead.forEach((row) => {
    if (row.count > 0) {
      alerts.push({ queue: row.queue, kind: "dead_jobs", level: "critical", count: row.count });
    }
  });
  snapshot.stalledPending.forEach((row) => {
    if (row.count > 0) {
      alerts.push({ queue: row.queue, kind: "stalled_pending", level: "critical", count: row.count, oldestAt: row.oldestAt });
    }
  });
  snapshot.staleProcessing.forEach((row) => {
    if (row.count > 0) {
      alerts.push({ queue: row.queue, kind: "stale_processing", level: "critical", count: row.count, oldestAt: row.oldestAt });
    }
  });
  snapshot.repeatedFailures.forEach((row) => {
    if (row.count > 0) {
      alerts.push({ queue: row.queue, kind: "repeated_failures", level: "warn", count: row.count });
    }
  });

  return { checkedAt: now, alerts };
}

export async function inspectQueueHealth(now = new Date()): Promise<QueueHealthReport> {
  const stalePendingBefore = new Date(now.getTime() - STALLED_PENDING_AFTER_MS);
  const staleProcessingBefore = new Date(now.getTime() - STALE_PROCESSING_AFTER_MS);

  const [dead, stalledPending, staleProcessing, repeatedFailures] = await Promise.all([
    db
      .select({ queue: jobs.queue, count: count() })
      .from(jobs)
      .where(and(eq(jobs.status, "dead"), isNull(jobs.deadLetterDisposition)))
      .groupBy(jobs.queue),
    db
      .select({ queue: jobs.queue, count: count(), oldestAt: min(jobs.runAt) })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, stalePendingBefore)))
      .groupBy(jobs.queue),
    db
      .select({ queue: jobs.queue, count: count(), oldestAt: min(jobs.lockedAt) })
      .from(jobs)
      .where(and(eq(jobs.status, "processing"), lt(jobs.lockedAt, staleProcessingBefore)))
      .groupBy(jobs.queue),
    db
      .select({ queue: jobs.queue, count: count() })
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "pending"),
          isNotNull(jobs.lastError),
          gte(jobs.attempts, REPEATED_FAILURE_ATTEMPTS),
        ),
      )
      .groupBy(jobs.queue),
  ]);

  return evaluateQueueHealth(
    {
      dead: dead.map((row) => ({ queue: row.queue, count: Number(row.count) })),
      stalledPending: stalledPending.map((row) => ({
        queue: row.queue,
        count: Number(row.count),
        oldestAt: row.oldestAt,
      })),
      staleProcessing: staleProcessing.map((row) => ({
        queue: row.queue,
        count: Number(row.count),
        oldestAt: row.oldestAt,
      })),
      repeatedFailures: repeatedFailures.map((row) => ({ queue: row.queue, count: Number(row.count) })),
    },
    now,
  );
}
