import { describe, expect, it } from "vitest";
import {
  APPROVED_EVAL_VERSION,
  LIVE_COMPARISON_VERSION,
  keyedRef,
  pairApprovedEvalRecords,
  parseApprovedEvalRecord,
  parseLiveComparisonRecord,
} from "@/application/conversation-v2/comparison-record";

const ref = (value: string): `hmac:${string}` => `hmac:${"a".repeat(63)}${value}`;

function live(overrides: Record<string, unknown> = {}) {
  return {
    version: LIVE_COMPARISON_VERSION,
    turnRef: ref("1"), conversationRef: null, inputRef: ref("2"),
    occurredAt: "2026-08-16T12:00:00.000Z", commit: "0faea93a",
    configDigest: ref("3"), datasetDigest: null,
    v1: { status: "observed", understandingRequest: "price-of-service", capabilityIds: ["dental-catalog"], decisionKinds: ["answer"], outcomeTypes: ["catalog_answered"], semanticClasses: ["information_authorized"], finalTextCharacters: 12, finalTextDigest: ref("4"), fallbackSource: null, errorCode: null, model: { modelId: "gpt-5.4-mini", calls: 1, inputTokens: 4, outputTokens: 2, latencyMs: 11, estimatedCostMinor: 1 } },
    v2: { status: "simulation_not_executed", understandingRequest: "book-appointment", capabilityIds: ["dental-scheduling"], decisionKinds: ["execute"], outcomeTypes: [], semanticClasses: [], finalTextCharacters: null, finalTextDigest: null, fallbackSource: null, errorCode: null, model: null },
    comparisonStatus: "comparable", comparisonReason: null,
    intendedEffects: [], divergenceCodes: [], ...overrides,
  };
}

describe("Cycle I comparison records", () => {
  it("only accepts strict HMAC-only live summaries and freezes them", () => {
    const parsed = parseLiveComparisonRecord(live(), new Set(["gpt-5.4-mini"]));
    expect(parsed.turnRef).toMatch(/^hmac:[a-f0-9]{64}$/);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.v1.capabilityIds)).toBe(true);
    expect(() => parseLiveComparisonRecord(live({ leadMessage: "oi" }), new Set(["gpt-5.4-mini"]))).toThrow(/leadMessage|unrecognized/i);
    expect(() => parseLiveComparisonRecord(live({ turnRef: "turn-123" }), new Set(["gpt-5.4-mini"]))).toThrow(/hmac/i);
    expect(() => parseLiveComparisonRecord(live(), new Set(["other-model"]))).toThrow(/model/i);
  });

  it("does not retain mutable aliases from the caller", () => {
    const input = live();
    const parsed = parseLiveComparisonRecord(input, new Set(["gpt-5.4-mini"]));
    (input.v1 as { capabilityIds: string[] }).capabilityIds[0] = "dental-escalation";
    expect(parsed.v1.capabilityIds).toEqual(["dental-catalog"]);
    expect(() => (parsed.v1.capabilityIds as string[]).push("dental-escalation")).toThrow();
  });

  it("rejects raw PII, free text, provider fields, and invalid versions from live records", () => {
    for (const field of [
      { leadMessage: "+55 11 99999-9999" },
      { history: "ana@example.com" },
      { prompt: "https://private.example/prompt" },
      { responseText: "resposta" },
      { providerPayload: { id: "provider-1" } },
      { turnId: "550e8400-e29b-41d4-a716-446655440000" },
    ]) expect(() => parseLiveComparisonRecord(live(field), new Set(["gpt-5.4-mini"]))).toThrow();
    expect(() => parseLiveComparisonRecord(live({ version: "conversation-v2-live-comparison.v9" }), new Set(["gpt-5.4-mini"]))).toThrow();
  });

  it("derives keyed references deterministically without sharing keys", () => {
    expect(keyedRef("turn", "one")).toBe(keyedRef("turn", "one"));
    expect(keyedRef("turn", "one")).not.toBe(keyedRef("turn", "two"));
  });

  it("keeps an arm without final response authority explicitly unobserved and closes divergence", () => {
    const unavailableV1 = {
      status: "unavailable",
      understandingRequest: null,
      capabilityIds: [],
      decisionKinds: [],
      outcomeTypes: [],
      semanticClasses: [],
      finalTextCharacters: null,
      finalTextDigest: null,
      fallbackSource: null,
      errorCode: "final_response_unavailable",
      model: null,
    };
    const parsed = parseLiveComparisonRecord(live({
      v1: unavailableV1,
      comparisonStatus: "not_measurable",
      comparisonReason: "v1_final_response_unavailable",
    }), new Set(["gpt-5.4-mini"]));

    expect(parsed.v1).toEqual(unavailableV1);
    expect(parsed.comparisonStatus).toBe("not_measurable");
    expect(parsed.divergenceCodes).toEqual([]);
    expect(() => parseLiveComparisonRecord(live({
      v1: unavailableV1,
      comparisonStatus: "not_measurable",
      comparisonReason: "v1_final_response_unavailable",
      divergenceCodes: ["outcome_mismatch"],
    }), new Set(["gpt-5.4-mini"]))).toThrow(/divergence|measurable/i);
  });

  it("only permits evaluation text from an approved corpus or signed replay", () => {
    const record = parseApprovedEvalRecord({ version: APPROVED_EVAL_VERSION, run: 1, caseId: "price-0001", arm: "v1", snapshotDigest: ref("5"), outputText: "texto sanitizado", source: { kind: "committed_corpus", corpusDigest: ref("6") } });
    expect(Object.isFrozen(record)).toBe(true);
    expect(() => parseApprovedEvalRecord({ ...record, source: { kind: "freeform" } })).toThrow();
  });

  it("forms pairs only when both arms share an immutable snapshot", () => {
    const v1 = parseApprovedEvalRecord({ version: APPROVED_EVAL_VERSION, run: 1, caseId: "price-0001", arm: "v1", snapshotDigest: ref("5"), outputText: "a", source: { kind: "committed_corpus", corpusDigest: ref("6") } });
    const v2 = parseApprovedEvalRecord({ ...v1, arm: "v2", outputText: "b" });
    expect(pairApprovedEvalRecords([v1, v2])).toHaveLength(1);
    expect(() => pairApprovedEvalRecords([v1])).toThrow(/missing/i);
    expect(() => pairApprovedEvalRecords([v1, { ...v2, snapshotDigest: ref("7") }])).toThrow(/snapshot/i);
  });
});
