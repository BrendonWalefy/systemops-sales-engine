import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateRuntimePerformance,
  parseRuntimePerformanceReport,
  type RuntimeArmMetrics,
  type RuntimePerformanceReport,
} from "@/application/conversation-v2/v2-runtime-performance";

function metrics(arm: RuntimeArmMetrics["arm"]): RuntimeArmMetrics {
  return {
    arm,
    turns: 102,
    latencyMs: { p50: 100, p95: 200 },
    modelCalls: { mean: 1, p95: 1 },
    tokens: { mean: 500, p95: 800 },
    database: { statementsP95: 12, roundTripsP95: 4, lockHoldP95Ms: 10 },
    cardinality: { events: 102, processJobs: 102, liveReplies: 96, sendJobs: 96 },
  };
}

function report(): RuntimePerformanceReport {
  return {
    version: "v2-only-runtime-performance.v1",
    population: { cases: 17, repetitions: 6, turnsPerArm: 102 },
    arms: [metrics("v1_current"), metrics("v2_only")],
  };
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("V2-only runtime performance baseline", () => {
  it("accepts the complete numeric schema and an equal candidate", () => {
    const baseline = report();

    expect(parseRuntimePerformanceReport(baseline)).toEqual(baseline);
    expect(evaluateRuntimePerformance(baseline.arms[1]!, baseline.arms[0]!))
      .toEqual({ passed: true, violations: [] });
  });

  it("rejects null metric groups and all threshold/cardinality regressions", () => {
    const baseline = report();
    const candidate = metrics("v2_only");

    expect(() => parseRuntimePerformanceReport({
      ...baseline,
      arms: [{ ...baseline.arms[0], modelCalls: null }, baseline.arms[1]],
    })).toThrow();

    const regressed = {
      ...candidate,
      latencyMs: { p50: 111, p95: 251 },
      modelCalls: { mean: 2, p95: 2 },
      tokens: { mean: 551, p95: 921 },
      database: { statementsP95: 14, roundTripsP95: 7, lockHoldP95Ms: 16 },
      cardinality: { events: 102, processJobs: 103, liveReplies: 97, sendJobs: 96 },
    } satisfies RuntimeArmMetrics;

    expect(evaluateRuntimePerformance(regressed, baseline.arms[0]!)).toEqual({
      passed: false,
      violations: [
        "latencyMs.p50",
        "latencyMs.p95",
        "modelCalls.mean",
        "modelCalls.p95",
        "tokens.mean",
        "tokens.p95",
        "database.statementsP95",
        "database.roundTripsP95",
        "database.lockHoldP95Ms",
        "cardinality.processJobs",
        "cardinality.sendJobs",
      ],
    });
  });

  it("keeps measurement artifacts unreachable from production roots", () => {
    const productionSources = ["src/app", "src/application", "src/core", "src/infrastructure"].flatMap(sourceFiles);

    expect(productionSources).not.toEqual([]);
    for (const path of productionSources) {
      expect(readFileSync(path, "utf8")).not.toContain("v2-runtime-performance");
      expect(readFileSync(path, "utf8")).not.toContain("V2OnlyRuntimePerformanceMeasurement");
    }
  });
});
