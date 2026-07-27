export const DEFAULT_MESSAGE_PROCESS_BATCH_SIZE = 10;
export const DEFAULT_MESSAGE_SEND_BATCH_SIZE = 20;
export const MAX_MESSAGE_PROCESS_BATCH_SIZE = 25;
export const MAX_MESSAGE_SEND_BATCH_SIZE = 50;

export function resolveWorkerBatchSize(
  raw: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(parsed)));
}
