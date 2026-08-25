import { describe, expect, it } from "vitest";
import {
  evaluateRuntimePerformanceReport,
  type RuntimePerformanceReport,
} from "@/application/conversation-v2/v2-runtime-performance";
import {
  buildRuntimePerformancePopulation,
} from "./runtime-performance-population";

const manifest = {
  version: "manifest.v1",
  population: "runtime",
  cases: [
    { caseId: "case-0001", requiredAxes: ["request"], critical: true },
    { caseId: "case-0002", requiredAxes: ["request"], critical: false },
  ],
};

const fixtures = [
  {
    schemaVersion: "corpus-case.v1",
    caseId: "case-0001",
    journey: "availability",
    source: { kind: "synthetic_regression", tenantHash: "aaaaaaaa", conversationHash: "bbbbbbbb", turnIndex: 1, capturedAt: "2026-08-25T00:00:00.000Z" },
    input: { leadMessage: "first", history: [], state: null, tenantConfigRef: "tenant-a" },
    observed: { aiResponse: null, humanResponse: null },
    labels: {
      understanding: { request: "book-appointment", dialogueMove: "new_topic", entities: {}, signals: {}, safety: {}, ambiguity: null },
      expectedActionResult: { type: "slots_found" },
      prose: { ai: null, human: null },
      betterResponder: "not_applicable",
    },
    provenance: { reviewer: "reviewer", reviewedAt: "2026-08-25T00:00:00.000Z" },
    tags: ["regression:runtime"],
  },
  {
    schemaVersion: "corpus-case.v1",
    caseId: "case-0002",
    journey: "price",
    source: { kind: "synthetic_regression", tenantHash: "aaaaaaaa", conversationHash: "cccccccc", turnIndex: 2, capturedAt: "2026-08-25T00:00:00.000Z" },
    input: { leadMessage: "second", history: [{ author: "lead", body: "history" }], state: null, tenantConfigRef: "tenant-a" },
    observed: { aiResponse: "observed", humanResponse: null },
    labels: {
      understanding: { request: "price-of-service", dialogueMove: "new_topic", entities: { service: "Service Two" }, signals: {}, safety: {}, ambiguity: null },
      expectedActionResult: { type: "price_inquiry", identifiedTreatment: "Service Two" },
      prose: { ai: null, human: null },
      betterResponder: "not_applicable",
    },
    provenance: { reviewer: "reviewer", reviewedAt: "2026-08-25T00:00:00.000Z" },
    tags: ["regression:runtime"],
  },
] as const;

const tenantConfig = {
  ref: "tenant-a",
  segment: "dental",
  timezone: "America/Sao_Paulo",
  businessHours: "Seg-Sex 08:00-18:00",
  facts: { address: { status: "known", value: "sanitized", source: "fixture" } },
  services: [
    { name: "Service One", priceCents: null, freeEvaluation: true },
    { name: "Service Two", priceCents: 12300, description: "Complete description", requiresEvaluationFirst: true },
  ],
  provenance: { readOnly: true, note: "committed config" },
};

function population(config: unknown = tenantConfig, selectedFixtures: readonly unknown[] = fixtures) {
  return buildRuntimePerformancePopulation({
    manifestPath: "evals/understanding/runtime.json",
    manifest,
    fixtures: selectedFixtures,
    tenantConfigs: new Map([["tenant-a", config]]),
  });
}

function reportWithDigest(populationDigest: string): RuntimePerformanceReport {
  const metrics = (arm: "v1_current" | "v2_only") => ({
    arm,
    turns: 102,
    latencyMs: { p50: 1, p95: 1 },
    modelCalls: { mean: 1, p95: 1 },
    tokens: { mean: 1, p95: 1 },
    database: { statementsP95: 1, roundTripsP95: 1, lockHoldP95Ms: 1 },
    cardinality: { events: 102, processJobs: 102, liveReplies: 102, sendJobs: 102 },
  });
  return {
    version: "v2-only-runtime-performance.v2",
    provenance: {
      commit: "a".repeat(40),
      node: "v25.9.0",
      platform: "darwin",
      arch: "arm64",
      database: {
        embeddedPostgresql: { package: "embedded-postgres", packageVersion: "1", serverVersion: "1" },
        nodePostgres: { package: "pg", packageVersion: "1" },
      },
      populationDigest,
      populationDigestSemantics: "ordered-manifest+complete-corpus+normalized-tenant-configs+derived-inputs.v1",
      lockHoldMetricSemantics: "whatsapp-stream-authority.explicit-after-acquisition-to-end.autocommit-statement-upper-bound.v1",
      armOrderPolicy: "alternate-by-repetition.v1-first-even.v2-first-odd",
      armOrder: [
        ["v1_current", "v2_only"], ["v2_only", "v1_current"],
        ["v1_current", "v2_only"], ["v2_only", "v1_current"],
        ["v1_current", "v2_only"], ["v2_only", "v1_current"],
      ],
    },
    population: { cases: 17, repetitions: 6, turnsPerArm: 102 },
    arms: [metrics("v1_current"), metrics("v2_only")],
  };
}

describe("runtime performance population protocol", () => {
  it("derives the complete committed catalog and fixture context in manifest order", () => {
    const built = population();

    expect(built.fixtureInputs.map((fixture) => fixture.caseId)).toEqual(["case-0001", "case-0002"]);
    expect(built.fixtureInputs[0]?.catalog.map((service) => service.name)).toEqual([
      "Service One",
      "Service Two",
    ]);
    expect(built.fixtureInputs[0]?.lead.treatmentInterest).toBe("Service One");
    expect(built.fixtureInputs[1]?.history).toEqual([{ author: "lead", body: "history", minutesBeforeTurn: 2 }]);
  });

  it("changes the protocol digest when any normalized tenant-config content drifts", () => {
    const original = population();
    const changed = population({
      ...tenantConfig,
      facts: { address: { ...tenantConfig.facts.address, value: "changed sanitized fact" } },
    });

    expect(changed.populationDigest).not.toBe(original.populationDigest);
    expect(evaluateRuntimePerformanceReport(
      reportWithDigest(changed.populationDigest),
      reportWithDigest(original.populationDigest),
    )).toEqual({ passed: false, violations: ["protocol.populationDigest"] });
  });

  it("changes the digest for ordered-manifest or complete-corpus drift", () => {
    const original = population();
    const reordered = buildRuntimePerformancePopulation({
      manifestPath: "evals/understanding/runtime.json",
      manifest: { ...manifest, cases: [...manifest.cases].reverse() },
      fixtures: [...fixtures].reverse(),
      tenantConfigs: new Map([["tenant-a", tenantConfig]]),
    });
    const corpusChanged = population(tenantConfig, [
      { ...fixtures[0], observed: { ...fixtures[0].observed, aiResponse: "complete-record-drift" } },
      fixtures[1],
    ]);

    expect(reordered.populationDigest).not.toBe(original.populationDigest);
    expect(corpusChanged.populationDigest).not.toBe(original.populationDigest);
  });

  it("normalizes object key order without changing the digest", () => {
    const reorderedConfig = {
      provenance: tenantConfig.provenance,
      services: tenantConfig.services,
      facts: tenantConfig.facts,
      businessHours: tenantConfig.businessHours,
      timezone: tenantConfig.timezone,
      segment: tenantConfig.segment,
      ref: tenantConfig.ref,
    };

    expect(population(reorderedConfig).populationDigest).toBe(population().populationDigest);
  });
});
