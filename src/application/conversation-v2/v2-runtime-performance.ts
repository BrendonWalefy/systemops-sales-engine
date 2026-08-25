import { z } from "zod";

export type RuntimeArmMetrics = Readonly<{
  arm: "v1_current" | "v2_only";
  turns: number;
  latencyMs: Readonly<{ p50: number; p95: number }>;
  modelCalls: Readonly<{ mean: number; p95: number }>;
  tokens: Readonly<{ mean: number; p95: number }>;
  database: Readonly<{
    statementsP95: number;
    roundTripsP95: number;
    lockHoldP95Ms: number;
  }>;
  cardinality: Readonly<{
    events: number;
    processJobs: number;
    liveReplies: number;
    sendJobs: number;
  }>;
}>;

export type RuntimePerformanceReport = Readonly<{
  version: "v2-only-runtime-performance.v1";
  provenance: Readonly<{
    commit: string;
    node: string;
    platform: string;
    arch: string;
    database: Readonly<{
      embeddedPostgresql: Readonly<{
        package: "embedded-postgres";
        packageVersion: string;
        serverVersion: string;
      }>;
      nodePostgres: Readonly<{
        package: "pg";
        packageVersion: string;
      }>;
    }>;
    populationDigest: string;
    armOrderPolicy: "alternate-by-repetition.v1-first-even.v2-first-odd";
    armOrder: readonly [
      readonly ["v1_current", "v2_only"],
      readonly ["v2_only", "v1_current"],
      readonly ["v1_current", "v2_only"],
      readonly ["v2_only", "v1_current"],
      readonly ["v1_current", "v2_only"],
      readonly ["v2_only", "v1_current"],
    ];
  }>;
  population: Readonly<{ cases: 17; repetitions: 6; turnsPerArm: 102 }>;
  arms: readonly [RuntimeArmMetrics, RuntimeArmMetrics];
}>;

export type RuntimePerformanceEvaluation = Readonly<{
  passed: boolean;
  violations: readonly string[];
}>;

const nonNegative = z.number().finite().nonnegative();
const armMetricsSchema = z.object({
  arm: z.enum(["v1_current", "v2_only"]),
  turns: z.number().int().positive(),
  latencyMs: z.object({ p50: nonNegative, p95: nonNegative }).strict(),
  modelCalls: z.object({ mean: nonNegative, p95: nonNegative }).strict(),
  tokens: z.object({ mean: nonNegative, p95: nonNegative }).strict(),
  database: z.object({
    statementsP95: nonNegative,
    roundTripsP95: nonNegative,
    lockHoldP95Ms: nonNegative,
  }).strict(),
  cardinality: z.object({
    events: z.number().int().nonnegative(),
    processJobs: z.number().int().nonnegative(),
    liveReplies: z.number().int().nonnegative(),
    sendJobs: z.number().int().nonnegative(),
  }).strict(),
}).strict();

const reportSchema = z.object({
  version: z.literal("v2-only-runtime-performance.v1"),
  provenance: z.object({
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    node: z.string().regex(/^v\d+\.\d+\.\d+/),
    platform: z.string().min(1),
    arch: z.string().min(1),
    database: z.object({
      embeddedPostgresql: z.object({
        package: z.literal("embedded-postgres"),
        packageVersion: z.string().min(1),
        serverVersion: z.string().min(1),
      }).strict(),
      nodePostgres: z.object({
        package: z.literal("pg"),
        packageVersion: z.string().min(1),
      }).strict(),
    }).strict(),
    populationDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    armOrderPolicy: z.literal("alternate-by-repetition.v1-first-even.v2-first-odd"),
    armOrder: z.tuple([
      z.tuple([z.literal("v1_current"), z.literal("v2_only")]),
      z.tuple([z.literal("v2_only"), z.literal("v1_current")]),
      z.tuple([z.literal("v1_current"), z.literal("v2_only")]),
      z.tuple([z.literal("v2_only"), z.literal("v1_current")]),
      z.tuple([z.literal("v1_current"), z.literal("v2_only")]),
      z.tuple([z.literal("v2_only"), z.literal("v1_current")]),
    ]),
  }).strict(),
  population: z.object({
    cases: z.literal(17),
    repetitions: z.literal(6),
    turnsPerArm: z.literal(102),
  }).strict(),
  arms: z.tuple([armMetricsSchema, armMetricsSchema]),
}).strict().superRefine((report, ctx) => {
  const [first, second] = report.arms;
  if (first.arm !== "v1_current" || second.arm !== "v2_only") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "runtime arms must be v1_current then v2_only" });
  }
  for (const arm of report.arms) {
    if (arm.turns !== report.population.turnsPerArm) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "arm turn count must match the fixed population" });
    }
    if (arm.latencyMs.p50 > arm.latencyMs.p95) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["arms", arm.arm, "latencyMs"],
        message: "latency p50 must not exceed p95",
      });
    }
  }
});

export function parseRuntimePerformanceReport(input: unknown): RuntimePerformanceReport {
  return reportSchema.parse(input) as RuntimePerformanceReport;
}

function exceeds(candidate: number, baseline: number, factor: number, absolute?: number): boolean {
  return candidate > baseline * factor || (absolute !== undefined && candidate - baseline > absolute);
}

export function evaluateRuntimePerformance(
  candidate: RuntimeArmMetrics,
  baseline: RuntimeArmMetrics,
): RuntimePerformanceEvaluation {
  const violations: string[] = [];
  if (exceeds(candidate.latencyMs.p50, baseline.latencyMs.p50, 1.10, 100)) violations.push("latencyMs.p50");
  if (exceeds(candidate.latencyMs.p95, baseline.latencyMs.p95, 1.10, 250)) violations.push("latencyMs.p95");
  if (candidate.modelCalls.mean > baseline.modelCalls.mean) violations.push("modelCalls.mean");
  if (candidate.modelCalls.p95 > baseline.modelCalls.p95) violations.push("modelCalls.p95");
  if (candidate.tokens.mean > baseline.tokens.mean * 1.10) violations.push("tokens.mean");
  if (candidate.tokens.p95 > baseline.tokens.p95 * 1.15) violations.push("tokens.p95");
  if (candidate.database.statementsP95 > baseline.database.statementsP95 * 1.10) violations.push("database.statementsP95");
  if (candidate.database.roundTripsP95 > baseline.database.roundTripsP95 + 2) violations.push("database.roundTripsP95");
  if (exceeds(candidate.database.lockHoldP95Ms, baseline.database.lockHoldP95Ms, 1.10, 5)) violations.push("database.lockHoldP95Ms");

  if (candidate.cardinality.events !== candidate.turns) violations.push("cardinality.events");
  if (candidate.cardinality.processJobs !== candidate.cardinality.events) violations.push("cardinality.processJobs");
  if (candidate.cardinality.liveReplies > candidate.turns) violations.push("cardinality.liveReplies");
  if (candidate.cardinality.sendJobs !== candidate.cardinality.liveReplies) violations.push("cardinality.sendJobs");

  return Object.freeze({ passed: violations.length === 0, violations: Object.freeze(violations) });
}

function samePopulation(
  current: RuntimePerformanceReport["population"],
  frozen: RuntimePerformanceReport["population"],
): boolean {
  return current.cases === frozen.cases
    && current.repetitions === frozen.repetitions
    && current.turnsPerArm === frozen.turnsPerArm;
}

function sameArmOrder(
  current: RuntimePerformanceReport["provenance"]["armOrder"],
  frozen: RuntimePerformanceReport["provenance"]["armOrder"],
): boolean {
  return current.every((pair, index) => (
    pair[0] === frozen[index]?.[0] && pair[1] === frozen[index]?.[1]
  ));
}

function structuralCardinalityViolations(
  report: RuntimePerformanceReport,
  source: "current" | "frozen",
): string[] {
  const violations: string[] = [];
  for (const arm of report.arms) {
    for (const field of ["events", "processJobs", "liveReplies", "sendJobs"] as const) {
      if (arm.cardinality[field] !== arm.turns) {
        violations.push(`${source}.${arm.arm}.cardinality.${field}`);
      }
    }
  }
  return violations;
}

export function evaluateRuntimePerformanceReport(
  current: RuntimePerformanceReport,
  frozen: RuntimePerformanceReport,
): RuntimePerformanceEvaluation {
  const violations: string[] = [];
  if (current.provenance.populationDigest !== frozen.provenance.populationDigest) {
    violations.push("protocol.populationDigest");
  }
  if (!samePopulation(current.population, frozen.population)) violations.push("protocol.population");
  if (current.provenance.armOrderPolicy !== frozen.provenance.armOrderPolicy) {
    violations.push("protocol.armOrderPolicy");
  }
  if (!sameArmOrder(current.provenance.armOrder, frozen.provenance.armOrder)) {
    violations.push("protocol.armOrder");
  }
  violations.push(...structuralCardinalityViolations(frozen, "frozen"));
  violations.push(...structuralCardinalityViolations(current, "current"));

  if (violations.length > 0) {
    return Object.freeze({ passed: false, violations: Object.freeze(violations) });
  }

  return evaluateRuntimePerformance(current.arms[1], current.arms[0]);
}
