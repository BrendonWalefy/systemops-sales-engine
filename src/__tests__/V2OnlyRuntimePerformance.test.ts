import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
    provenance: {
      commit: "f15865539731a668c9a7095ff6c9a1df798e2db3",
      node: "v25.9.0",
      platform: "darwin",
      arch: "arm64",
      database: {
        embeddedPostgresql: { package: "embedded-postgres", packageVersion: "17.5.0", serverVersion: "17.5" },
        nodePostgres: { package: "pg", packageVersion: "8.16.3" },
      },
      populationDigest: `sha256:${"a".repeat(64)}`,
      armOrderPolicy: "alternate-by-repetition.v1-first-even.v2-first-odd",
      armOrder: [
        ["v1_current", "v2_only"],
        ["v2_only", "v1_current"],
        ["v1_current", "v2_only"],
        ["v2_only", "v1_current"],
        ["v1_current", "v2_only"],
        ["v2_only", "v1_current"],
      ],
    },
    population: { cases: 17, repetitions: 6, turnsPerArm: 102 },
    arms: [metrics("v1_current"), metrics("v2_only")],
  } as RuntimePerformanceReport;
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

  it("rejects percentile inversions in either arm", () => {
    const baseline = report();

    expect(() => parseRuntimePerformanceReport({
      ...baseline,
      arms: [
        { ...baseline.arms[0], latencyMs: { p50: 201, p95: 200 } },
        baseline.arms[1],
      ],
    })).toThrow(/p50|p95|percentile/i);
  });

  it("rejects absolute-only latency and lock regressions even when ratios pass", () => {
    const baseline = {
      ...metrics("v1_current"),
      latencyMs: { p50: 2_000, p95: 3_000 },
      database: { ...metrics("v1_current").database, lockHoldP95Ms: 100 },
    };
    const candidate = {
      ...metrics("v2_only"),
      latencyMs: { p50: 2_101, p95: 3_251 },
      database: { ...metrics("v2_only").database, lockHoldP95Ms: 106 },
    };

    expect(evaluateRuntimePerformance(candidate, baseline).violations).toEqual([
      "latencyMs.p50",
      "latencyMs.p95",
      "database.lockHoldP95Ms",
    ]);
  });

  it.each(["--baseline", "--write-baseline"])("rejects a missing value for %s", (flag) => {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      "scripts/measure-v2-only-runtime.ts",
      flag,
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        NODE_ENV: "test",
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/requires a value/i);
  });

  it.each([
    ["PGHOST", "external.example"],
    ["HTTPS_PROXY", "http://127.0.0.1:8080"],
    ["NODE_OPTIONS", "--no-warnings"],
    ["SERVICE_API_KEY", "credential"],
  ])("rejects inherited unsafe environment variable %s", (name, value) => {
    const result = spawnSync(process.execPath, [
      join(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
      "scripts/measure-v2-only-runtime.ts",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        NODE_ENV: "test",
        [name]: value,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`measurement refuses inherited ${name}`);
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
