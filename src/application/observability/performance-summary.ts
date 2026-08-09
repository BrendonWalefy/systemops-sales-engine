import {
  parsePerformanceSample,
  type PerformanceSample,
} from "@/application/observability/performance-telemetry";

export type PerformanceSummaryRow = {
  key: string;
  count: number;
  p50Ms: number;
  p75Ms: number;
  p95Ms: number;
  maxMs: number;
};

function percentile(sortedDurations: number[], percentileValue: number): number {
  const index = Math.min(
    sortedDurations.length - 1,
    Math.max(0, Math.ceil(percentileValue * sortedDurations.length) - 1),
  );

  return sortedDurations[index];
}

export function summarizePerformanceSamples(
  samples: PerformanceSample[],
): PerformanceSummaryRow[] {
  const durationsByKey = new Map<string, number[]>();

  for (const sample of samples) {
    const validatedSample = parsePerformanceSample(sample);
    const key = [
      validatedSample.source,
      validatedSample.surface,
      validatedSample.operation,
      validatedSample.outcome,
    ].join("|");
    const durations = durationsByKey.get(key) ?? [];

    durations.push(validatedSample.durationMs);
    durationsByKey.set(key, durations);
  }

  return [...durationsByKey.entries()]
    .sort(([leftKey], [rightKey]) => leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0)
    .map(([key, durations]) => {
      const sortedDurations = [...durations].sort((left, right) => left - right);

      return {
        key,
        count: sortedDurations.length,
        p50Ms: percentile(sortedDurations, 0.5),
        p75Ms: percentile(sortedDurations, 0.75),
        p95Ms: percentile(sortedDurations, 0.95),
        maxMs: sortedDurations[sortedDurations.length - 1],
      };
    });
}
