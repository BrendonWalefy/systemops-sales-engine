import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateRuntimePerformance,
  evaluateRuntimePerformanceReport,
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
    cardinality: { events: 102, processJobs: 102, liveReplies: 102, sendJobs: 102 },
  };
}

function report(): RuntimePerformanceReport {
  return {
    version: "v2-only-runtime-performance.v2",
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
      populationDigestSemantics: "ordered-manifest+complete-corpus+normalized-tenant-configs+derived-inputs.v1",
      lockHoldMetricSemantics: "whatsapp-stream-authority.explicit-after-acquisition-to-end.autocommit-statement-upper-bound.v1",
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

  it("rejects population digest drift before comparing volatile metrics", () => {
    const frozen = report();
    const current = {
      ...report(),
      provenance: {
        ...report().provenance,
        populationDigest: `sha256:${"b".repeat(64)}`,
      },
    } satisfies RuntimePerformanceReport;

    expect(evaluateRuntimePerformanceReport(current, frozen)).toEqual({
      passed: false,
      violations: ["protocol.populationDigest"],
    });
  });

  it("fails closed when host timing exceeds the direct frozen V2 budget", () => {
    const frozen = report();
    const source = report();
    const current = {
      ...source,
      arms: [
        { ...source.arms[0], latencyMs: { p50: 150, p95: 300 }, database: { ...source.arms[0].database, lockHoldP95Ms: 15 } },
        { ...source.arms[1], latencyMs: { p50: 150, p95: 300 }, database: { ...source.arms[1].database, lockHoldP95Ms: 15 } },
      ],
    } satisfies RuntimePerformanceReport;

    expect(evaluateRuntimePerformanceReport(current, frozen).violations).toEqual([
      "latencyMs.p50",
      "latencyMs.p95",
      "database.lockHoldP95Ms",
    ]);
  });

  it("handles zero metrics and cannot be masked by a drifting V1 comparator", () => {
    const source = report();
    const zeroReference = {
      ...source,
      arms: [
        {
          ...source.arms[0],
          latencyMs: { p50: 0, p95: 0 },
          database: { ...source.arms[0].database, lockHoldP95Ms: 0 },
        },
        {
          ...source.arms[1],
          latencyMs: { p50: 10, p95: 20 },
          database: { ...source.arms[1].database, lockHoldP95Ms: 1 },
        },
      ],
    } satisfies RuntimePerformanceReport;
    const zeroCurrent = {
      ...zeroReference,
      arms: [
        zeroReference.arms[0],
        {
          ...zeroReference.arms[1],
          latencyMs: { p50: 12, p95: 23 },
          database: { ...zeroReference.arms[1].database, lockHoldP95Ms: 1.2 },
        },
      ],
    } satisfies RuntimePerformanceReport;
    expect(evaluateRuntimePerformanceReport(zeroCurrent, zeroReference).violations).toEqual([
      "latencyMs.p50",
      "latencyMs.p95",
      "database.lockHoldP95Ms",
    ]);

    const allZero = {
      ...source,
      arms: source.arms.map((arm) => ({
        ...arm,
        latencyMs: { p50: 0, p95: 0 },
        database: { ...arm.database, lockHoldP95Ms: 0 },
      })) as unknown as RuntimePerformanceReport["arms"],
    } satisfies RuntimePerformanceReport;
    expect(evaluateRuntimePerformanceReport(allZero, allZero)).toEqual({
      passed: true,
      violations: [],
    });

    const driftingComparator = {
      ...source,
      arms: [
        {
          ...source.arms[0],
          latencyMs: { p50: 1_000, p95: 2_000 },
          database: { ...source.arms[0].database, lockHoldP95Ms: 100 },
        },
        {
          ...source.arms[1],
          latencyMs: { p50: 190, p95: 380 },
          database: { ...source.arms[1].database, lockHoldP95Ms: 19 },
        },
      ],
    } satisfies RuntimePerformanceReport;
    expect(evaluateRuntimePerformanceReport(driftingComparator, source).violations).toEqual([
      "latencyMs.p50",
      "latencyMs.p95",
      "database.lockHoldP95Ms",
    ]);
  });

  it("budgets model and token cost against the frozen V2 arm, not against V1", () => {
    const source = report();
    const frozen = {
      ...source,
      arms: [
        {
          ...source.arms[0],
          modelCalls: { mean: 1.8, p95: 2 },
          tokens: { mean: 36, p95: 46 },
        },
        {
          ...source.arms[1],
          modelCalls: { mean: 2, p95: 2 },
          tokens: { mean: 48, p95: 50 },
        },
      ],
    } satisfies RuntimePerformanceReport;
    const current = {
      ...frozen,
      arms: [
        {
          ...frozen.arms[0],
          modelCalls: { mean: 1.7, p95: 2 },
          tokens: { mean: 35, p95: 45 },
        },
        frozen.arms[1],
      ],
    } satisfies RuntimePerformanceReport;

    expect(evaluateRuntimePerformanceReport(current, frozen)).toEqual({
      passed: true,
      violations: [],
    });

    const regressed = {
      ...current,
      arms: [
        current.arms[0],
        {
          ...current.arms[1],
          modelCalls: { mean: 2.1, p95: 3 },
          tokens: { mean: 53, p95: 58 },
        },
      ],
    } satisfies RuntimePerformanceReport;
    expect(evaluateRuntimePerformanceReport(regressed, frozen).violations).toEqual([
      "modelCalls.mean",
      "modelCalls.p95",
      "tokens.mean",
      "tokens.p95",
    ]);
  });

  it("fails a V2-only latency regression against the frozen V2 arm", () => {
    const frozen = report();
    const source = report();
    const current = {
      ...source,
      arms: [
        { ...source.arms[0], latencyMs: { p50: 1_000, p95: 2_000 }, database: { ...source.arms[0].database, lockHoldP95Ms: 100 } },
        { ...source.arms[1], latencyMs: { p50: 1_101, p95: 2_251 }, database: { ...source.arms[1].database, lockHoldP95Ms: 106 } },
      ],
    } satisfies RuntimePerformanceReport;

    expect(evaluateRuntimePerformanceReport(current, frozen)).toEqual({
      passed: false,
      violations: ["latencyMs.p50", "latencyMs.p95", "database.lockHoldP95Ms"],
    });
  });

  it("rejects protocol drift while treating V1 cardinality as informational", () => {
    const frozen = report();
    const source = report();
    const current = {
      ...source,
      population: { cases: 18, repetitions: 6, turnsPerArm: 108 },
      provenance: {
        ...source.provenance,
        armOrder: [["v2_only", "v1_current"], ...source.provenance.armOrder.slice(1)],
      },
      arms: [
        { ...source.arms[0], cardinality: { ...source.arms[0].cardinality, liveReplies: 101 } },
        source.arms[1],
      ],
    } as unknown as RuntimePerformanceReport;

    expect(evaluateRuntimePerformanceReport(current, frozen)).toEqual({
      passed: false,
      violations: [
        "protocol.population",
        "protocol.armOrder",
      ],
    });
  });

  it("fails closed on V2 structural cardinality drift", () => {
    const frozen = report();
    const source = report();
    const current = {
      ...source,
      arms: [
        source.arms[0],
        { ...source.arms[1], cardinality: { ...source.arms[1].cardinality, liveReplies: 101 } },
      ],
    } satisfies RuntimePerformanceReport;

    expect(evaluateRuntimePerformanceReport(current, frozen)).toEqual({
      passed: false,
      violations: ["current.v2_only.cardinality.liveReplies"],
    });
  });

  it("rejects arm-order policy drift and invalid frozen cardinality", () => {
    const source = report();
    const current = {
      ...source,
      provenance: { ...source.provenance, armOrderPolicy: "run-v1-then-v2" },
    } as unknown as RuntimePerformanceReport;
    const frozen = {
      ...source,
      arms: [
        source.arms[0],
        { ...source.arms[1], cardinality: { ...source.arms[1].cardinality, sendJobs: 101 } },
      ],
    } satisfies RuntimePerformanceReport;

    expect(evaluateRuntimePerformanceReport(current, frozen)).toEqual({
      passed: false,
      violations: [
        "protocol.armOrderPolicy",
        "frozen.v2_only.cardinality.sendJobs",
      ],
    });
  });

  it("rejects population and lock metric semantic drift before volatile comparison", () => {
    const frozen = report();
    const source = report();
    const current = {
      ...source,
      provenance: {
        ...source.provenance,
        populationDigestSemantics: "partial-population.v0",
        lockHoldMetricSemantics: "all-dml.v0",
      },
    } as unknown as RuntimePerformanceReport;

    expect(evaluateRuntimePerformanceReport(current, frozen)).toEqual({
      passed: false,
      violations: [
        "protocol.populationDigestSemantics",
        "protocol.lockHoldMetricSemantics",
      ],
    });
  });

  it("keeps the measurement suite isolated behind the dedicated package command", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const exclusion = "--exclude src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts";

    expect(packageJson.scripts.test?.split(exclusion)).toHaveLength(2);
    expect(packageJson.scripts["measure:v2-only-runtime"]).toBe("tsx scripts/measure-v2-only-runtime.ts");
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
