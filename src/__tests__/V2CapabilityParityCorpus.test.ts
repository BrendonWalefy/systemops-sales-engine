import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loadV2CapabilityParityCorpus,
  parseV2CapabilityParityCorpus,
  V2_CAPABILITY_PARITY_CORPUS_VERSION,
} from "@/application/conversation-v2/v2-parity-corpus";
import { PROACTIVE_AUTHORIZATION_KINDS } from "@/application/automation/proactive-outbound";
import { DECISION_TRACE_STAGES } from "@/core/observability/DecisionTrace";
import { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";

const MANIFEST = "evals/v2-only/capability-parity-corpus.json";
const TERMINAL_STAGES = new Set(["delivery.sent", "turn.ignored", "turn.failed"]);

describe("V2 capability parity corpus", () => {
  it("covers every closed inbound request and proactive authorization exactly once", () => {
    const corpus = loadV2CapabilityParityCorpus(MANIFEST);
    const inbound = corpus.scenarios.filter((scenario) => scenario.kind === "inbound");
    const proactive = corpus.scenarios.filter((scenario) => scenario.kind === "proactive");

    expect(corpus.version).toBe(V2_CAPABILITY_PARITY_CORPUS_VERSION);
    expect(inbound.map(({ request }) => request).sort()).toEqual([...DENTAL_REQUESTS].sort());
    expect(proactive.map(({ authorizationKind }) => authorizationKind).sort())
      .toEqual([...PROACTIVE_AUTHORIZATION_KINDS].sort());
    expect(new Set(corpus.scenarios.map(({ id }) => id)).size).toBe(corpus.scenarios.length);
  });

  it("binds every scenario to valid outcomes, terminal trace evidence and existing tests", () => {
    const corpus = loadV2CapabilityParityCorpus(MANIFEST);
    const stages = new Set<string>(DECISION_TRACE_STAGES);
    const outcomes = new Set(Object.keys(DENTAL_OUTCOME_SCHEMA));

    for (const scenario of corpus.scenarios) {
      expect(scenario.requiredTraceStages.every((stage) => stages.has(stage))).toBe(true);
      expect(scenario.requiredTraceStages.some((stage) => TERMINAL_STAGES.has(stage))).toBe(true);
      expect(scenario.expectedOutcomes.every((outcome) => outcomes.has(outcome))).toBe(true);
      expect(scenario.evidenceTests.length).toBeGreaterThan(0);
      for (const path of scenario.evidenceTests) {
        expect(path).toMatch(/^src\/__tests__\/[A-Za-z0-9./-]+\.test\.ts$/);
        expect(existsSync(path), path).toBe(true);
      }
    }
  });

  it("is strict, immutable and rejects duplicates, unknown vocabulary and obvious PII", () => {
    const corpus = loadV2CapabilityParityCorpus(MANIFEST);
    expect(Object.isFrozen(corpus)).toBe(true);
    expect(Object.isFrozen(corpus.scenarios)).toBe(true);

    const first = corpus.scenarios[0]!;
    expect(() => parseV2CapabilityParityCorpus({
      ...corpus,
      scenarios: [...corpus.scenarios, first],
    })).toThrow(/duplicate/i);
    expect(() => parseV2CapabilityParityCorpus({
      ...corpus,
      scenarios: [{ ...first, request: "unknown-request" }],
    })).toThrow();
    expect(() => parseV2CapabilityParityCorpus({
      ...corpus,
      scenarios: corpus.scenarios.map((scenario, index) =>
        index === 0 ? { ...scenario, example: "Contato: pessoa@example.com" } : scenario),
    })).toThrow(/PII/i);
    expect(() => parseV2CapabilityParityCorpus({
      ...corpus,
      scenarios: corpus.scenarios.map((scenario, index) =>
        index === 0 ? { ...scenario, unexpected: true } : scenario),
    })).toThrow();
  });
});
