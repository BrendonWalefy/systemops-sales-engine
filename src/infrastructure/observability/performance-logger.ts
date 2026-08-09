import {
  PERFORMANCE_SCHEMA_VERSION,
  type PerformanceOperation,
  type PerformanceSample,
  type PerformanceSurface,
} from "@/application/observability/performance-telemetry";
import { createLogger } from "@/infrastructure/logging/logger";

type ServerTimingInput = {
  clinicId: string;
  surface: PerformanceSurface;
  operation: PerformanceOperation;
  enabled?: boolean;
};

type PerformanceLoggerDeps = {
  now(): number;
  emit(sample: PerformanceSample & { clinicId: string }): void;
};

export function recordServerPerformance(
  sample: PerformanceSample & { clinicId: string },
): void {
  const { clinicId, ...sampleWithoutClinicId } = sample;
  createLogger({ scope: "PerformanceTelemetry", clinicId })
    .info("performance.sample", sampleWithoutClinicId);
}

const defaultPerformanceLoggerDeps: PerformanceLoggerDeps = {
  now: () => performance.now(),
  emit: recordServerPerformance,
};

export async function measureServerOperation<T>(
  input: ServerTimingInput,
  work: () => Promise<T>,
  deps: PerformanceLoggerDeps = defaultPerformanceLoggerDeps,
): Promise<T> {
  const enabled = input.enabled ?? process.env.PERFORMANCE_TELEMETRY_ENABLED === "1";
  if (!enabled) return work();

  const startedAt = deps.now();
  let outcome: PerformanceSample["outcome"] = "error";

  try {
    const result = await work();
    outcome = "ok";
    return result;
  } finally {
    try {
      deps.emit({
        schemaVersion: PERFORMANCE_SCHEMA_VERSION,
        source: "server",
        surface: input.surface,
        operation: input.operation,
        durationMs: deps.now() - startedAt,
        outcome,
        clinicId: input.clinicId,
      });
    } catch {
      // Observability must never change the measured operation's result.
    }
  }
}
