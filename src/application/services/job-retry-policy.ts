import type { JobRecord } from "@/application/ports/job-queue";

const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

/**
 * Keeps retries predictable across runtimes. A future worker may add jitter
 * around this value, but the durable schedule remains bounded and testable.
 */
export function getJobRetryDelayMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

export function getJobRetryAt(job: JobRecord, now = new Date()): Date {
  return new Date(now.getTime() + getJobRetryDelayMs(job.attempts));
}
