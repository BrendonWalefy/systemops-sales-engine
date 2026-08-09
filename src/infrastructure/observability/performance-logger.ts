import {
  PERFORMANCE_SCHEMA_VERSION,
  parsePerformanceSample,
  type PerformanceOperation,
  type PerformanceSample,
  type PerformanceSurface,
} from "@/application/observability/performance-telemetry";
import { createLogger } from "@/infrastructure/logging/logger";

type ServerTimingContext =
  | { clinicId: string; getClinicId?: never }
  | { clinicId?: never; getClinicId(): string | null };

type ServerTimingInput = ServerTimingContext & {
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
  const normalizedSample = parsePerformanceSample({
    schemaVersion: sample.schemaVersion,
    source: sample.source,
    surface: sample.surface,
    operation: sample.operation,
    durationMs: sample.durationMs,
    ...(sample.cacheState === undefined ? {} : { cacheState: sample.cacheState }),
    outcome: sample.outcome,
  });
  createLogger({ scope: "PerformanceTelemetry", clinicId: sample.clinicId })
    .info("performance.sample", normalizedSample);
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
      const durationMs = deps.now() - startedAt;
      const clinicId = "clinicId" in input ? input.clinicId : input.getClinicId();
      if (clinicId) {
        deps.emit({
          schemaVersion: PERFORMANCE_SCHEMA_VERSION,
          source: "server",
          surface: input.surface,
          operation: input.operation,
          durationMs,
          outcome,
          clinicId,
        });
      }
    } catch {
      // Observability must never change the measured operation's result.
    }
  }
}
