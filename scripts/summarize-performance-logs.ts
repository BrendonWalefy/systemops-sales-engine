import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parsePerformanceSample, type PerformanceSample } from "@/application/observability/performance-telemetry";
import { summarizePerformanceSamples } from "@/application/observability/performance-summary";

const MINIMUM_BASELINE_SAMPLE_COUNT = 30;

function usage(): void {
  console.error("Usage: npm run performance:summary -- <performance-log.jsonl>");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractPerformanceLog(entry: unknown): Record<string, unknown> | null {
  const root = asRecord(entry);
  if (!root) return null;

  const candidates: Record<string, unknown>[] = [root];
  const message = root.message;
  const messageObject = asRecord(message);

  if (messageObject) {
    candidates.push(messageObject);
  } else if (typeof message === "string") {
    try {
      const parsedMessage = asRecord(JSON.parse(message));
      if (parsedMessage) candidates.push(parsedMessage);
    } catch {
      // A malformed Vercel message envelope is ignored without exposing it.
    }
  }

  return candidates.find((candidate) => candidate.msg === "performance.sample") ?? null;
}

function projectPerformanceSample(entry: unknown): PerformanceSample | null {
  const logEntry = extractPerformanceLog(entry);
  if (!logEntry) return null;

  try {
    return parsePerformanceSample({
      schemaVersion: logEntry.schemaVersion,
      source: logEntry.source,
      surface: logEntry.surface,
      operation: logEntry.operation,
      durationMs: logEntry.durationMs,
      ...(logEntry.cacheState === undefined ? {} : { cacheState: logEntry.cacheState }),
      outcome: logEntry.outcome,
    });
  } catch {
    return null;
  }
}

function coverage(count: number): string {
  return count < MINIMUM_BASELINE_SAMPLE_COUNT
    ? `insufficient (${count}/${MINIMUM_BASELINE_SAMPLE_COUNT})`
    : `sufficient (${count}/${MINIMUM_BASELINE_SAMPLE_COUNT})`;
}

async function readPerformanceSamples(filePath: string): Promise<PerformanceSample[]> {
  const samples: PerformanceSample[] = [];
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    try {
      const sample = projectPerformanceSample(JSON.parse(line));
      if (sample) samples.push(sample);
    } catch {
      // Invalid JSONL entries are not part of the versioned performance contract.
    }
  }

  return samples;
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    usage();
    process.exitCode = 2;
    return;
  }

  let samples: PerformanceSample[];
  try {
    samples = await readPerformanceSamples(filePath);
  } catch {
    console.error("Unable to read performance log.");
    process.exitCode = 1;
    return;
  }

  const summary = summarizePerformanceSamples(samples);
  if (summary.length === 0) {
    console.log("No valid performance samples found.");
    return;
  }

  console.log("| Group | Samples | Coverage | p50 (ms) | p75 (ms) | p95 (ms) | Max (ms) |");
  console.log("| --- | ---: | --- | ---: | ---: | ---: | ---: |");
  for (const row of summary) {
    console.log(
      `| ${row.key} | ${row.count} | ${coverage(row.count)} | ${row.p50Ms} | ${row.p75Ms} | ${row.p95Ms} | ${row.maxMs} |`,
    );
  }
}

void main();
