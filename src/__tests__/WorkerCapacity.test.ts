import { describe, expect, it } from "vitest";
import {
  DEFAULT_MESSAGE_PROCESS_BATCH_SIZE,
  DEFAULT_MESSAGE_SEND_BATCH_SIZE,
  MAX_MESSAGE_PROCESS_BATCH_SIZE,
  resolveWorkerBatchSize,
} from "@/application/jobs/worker-capacity";

describe("worker capacity", () => {
  it("supports at least one concurrent inbound job for each of ten tenants", () => {
    expect(DEFAULT_MESSAGE_PROCESS_BATCH_SIZE).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_MESSAGE_SEND_BATCH_SIZE).toBeGreaterThanOrEqual(10);
  });

  it("uses bounded overrides and rejects malformed capacity", () => {
    expect(resolveWorkerBatchSize(undefined, 10, 25)).toBe(10);
    expect(resolveWorkerBatchSize("not-a-number", 10, 25)).toBe(10);
    expect(resolveWorkerBatchSize("0", 10, 25)).toBe(1);
    expect(resolveWorkerBatchSize("100", 10, 25)).toBe(
      MAX_MESSAGE_PROCESS_BATCH_SIZE,
    );
  });
});
