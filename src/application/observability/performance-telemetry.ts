import { z } from "zod";
import {
  PERFORMANCE_OPERATIONS,
  PERFORMANCE_SCHEMA_VERSION,
  PERFORMANCE_SURFACES,
  type PerformanceSample,
} from "@/application/observability/performance-contract";

export {
  MAX_CLIENT_SAMPLES_PER_SESSION,
  PERFORMANCE_OPERATIONS,
  PERFORMANCE_SCHEMA_VERSION,
  PERFORMANCE_SURFACES,
  normalizePerformanceRoute,
  type PerformanceOperation,
  type PerformanceSample,
  type PerformanceSurface,
} from "@/application/observability/performance-contract";

const performanceSampleSchema = z
  .object({
    schemaVersion: z.literal(PERFORMANCE_SCHEMA_VERSION),
    source: z.enum(["client", "server"]),
    surface: z.enum(PERFORMANCE_SURFACES),
    operation: z.enum(PERFORMANCE_OPERATIONS),
    durationMs: z.number().finite().min(0).max(120_000),
    cacheState: z.enum(["cold", "warm", "unknown"]).optional(),
    outcome: z.enum(["ok", "error"]),
  })
  .strict();

export function parsePerformanceSample(sample: unknown): PerformanceSample {
  return performanceSampleSchema.parse(sample);
}
