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
    v1: { status: "observed", understandingRequest: "price-of-service", capabilityIds: ["dental-catalog"], decisionKinds: ["answer"], outcomes: [{ capabilityId: "dental-catalog", decisionKind: "answer", type: "catalog_answered", semanticClass: "information_authorized" }], finalTextCharacters: 12, finalTextDigest: ref("4"), fallbackSource: null, errorCode: null, model: { modelId: "gpt-5.4-mini", calls: 1, inputTokens: 4, outputTokens: 2, latencyMs: 11, estimatedCostMinor: 1 } },
    v2: { status: "unsupported", understandingRequest: null, capabilityIds: [], decisionKinds: [], outcomes: [], finalTextCharacters: null, finalTextDigest: null, fallbackSource: null, errorCode: "unsupported_request", model: null },
    comparisonStatus: "comparable", comparisonReason: null,
    intendedEffects: [], divergenceCodes: [], ...overrides,
  };
}

const emptyEngine = {
  understandingRequest: null,
  capabilityIds: [],
  decisionKinds: [],
  outcomes: [],
  finalTextCharacters: null,
  finalTextDigest: null,
  fallbackSource: null,
  errorCode: null,
  model: null,
} as const;

const observedV2 = {
  ...emptyEngine,
  status: "observed",
  understandingRequest: "price-of-service",
  capabilityIds: ["dental-catalog"],
  decisionKinds: ["answer"],
  outcomes: [{ capabilityId: "dental-catalog", decisionKind: "answer", type: "catalog_answered", semanticClass: "information_authorized" }],
  finalTextCharacters: 12,
  finalTextDigest: ref("8"),
} as const;

const intendedEffect = {
  kind: "would_have_executed",
  capabilityId: "dental-scheduling",
  payloadHash: "b".repeat(64),
  action: "book_slot",
  payload: { slotRefHash: "c".repeat(64) },
} as const;

describe("Cycle I comparison records", () => {
  it("only accepts strict HMAC-only live summaries and freezes them", () => {
    const parsed = parseLiveComparisonRecord(live(), new Set(["gpt-5.4-mini"]));
    expect(parsed.turnRef).toMatch(/^hmac:[a-f0-9]{64}$/);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.v1.capabilityIds)).toBe(true);
    expect(() => parseLiveComparisonRecord(live({ leadMessage: "oi" }), new Set(["gpt-5.4-mini"]))).toThrow(/leadMessage|unrecognized|exact root keys/i);
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

  it("emits only the v2 wire contract and rejects the pre-activation v1 prototype", () => {
    expect(LIVE_COMPARISON_VERSION).toBe("conversation-v2-live-comparison.v2");
    expect(() => parseLiveComparisonRecord(live({
      version: "conversation-v2-live-comparison.v1",
    }), new Set(["gpt-5.4-mini"]))).toThrow(/version|literal|invalid/i);
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
      outcomes: [],
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

  it.each([
    ["observed", observedV2],
    ["unsupported", { ...emptyEngine, status: "unsupported", errorCode: "unsupported_request" }],
    ["error", { ...emptyEngine, status: "error", errorCode: "provider_error" }],
    ["no_safe_response", {
      ...emptyEngine,
      status: "no_safe_response",
      capabilityIds: ["dental-catalog"],
      decisionKinds: ["answer"],
      outcomes: [{ capabilityId: "dental-catalog", decisionKind: "answer", type: "catalog_answered", semanticClass: "information_authorized" }],
    }],
    ["simulation_not_executed", {
      ...emptyEngine,
      status: "simulation_not_executed",
      capabilityIds: ["dental-scheduling"],
      decisionKinds: ["execute"],
    }],
  ])("accepts only the exact valid V2 %s shape in both comparison modes", (_status, v2) => {
    const intendedEffects = v2.status === "simulation_not_executed" ? [intendedEffect] : [];
    expect(parseLiveComparisonRecord(live({ v2, intendedEffects }), new Set(["gpt-5.4-mini"])).v2.status)
      .toBe(v2.status);
    expect(parseLiveComparisonRecord(live({
      v1: { ...emptyEngine, status: "unavailable", errorCode: "final_response_unavailable" },
      v2,
      intendedEffects,
      comparisonStatus: "not_measurable",
      comparisonReason: "v1_final_response_unavailable",
    }), new Set(["gpt-5.4-mini"])).v2.status).toBe(v2.status);
  });

  it.each([
    ["understanding", { understandingRequest: "price-of-service" }],
    ["capability", { capabilityIds: ["dental-catalog"] }],
    ["decision", { decisionKinds: ["answer"] }],
    ["outcome", { outcomes: [{ capabilityId: "dental-catalog", decisionKind: "answer", type: "catalog_answered", semanticClass: "information_authorized" }] }],
    ["final material", { finalTextCharacters: 1, finalTextDigest: ref("9") }],
    ["fallback", { fallbackSource: "fallback" }],
    ["model", { model: { modelId: "gpt-5.4-mini", calls: 1, inputTokens: null, outputTokens: null, latencyMs: 1, estimatedCostMinor: null } }],
  ])("rejects attributed %s in the exact unavailable V1 arm", (_label, attributed) => {
    expect(() => parseLiveComparisonRecord(live({
      v1: {
        ...emptyEngine,
        status: "unavailable",
        errorCode: "final_response_unavailable",
        ...attributed,
      },
      comparisonStatus: "not_measurable",
      comparisonReason: "v1_final_response_unavailable",
    }), new Set(["gpt-5.4-mini"]))).toThrow();
  });

  it.each([
    ["unsupported with outcomes", {
      ...emptyEngine, status: "unsupported", errorCode: "unsupported_request",
      outcomes: [{ capabilityId: "dental-catalog", decisionKind: "answer", type: "catalog_answered", semanticClass: "information_authorized" }],
    }],
    ["unsupported with final text", {
      ...emptyEngine, status: "unsupported", errorCode: "unsupported_request",
      finalTextCharacters: 1, finalTextDigest: ref("8"),
    }],
    ["unsupported with invalid zero-call model attribution", {
      ...emptyEngine, status: "unsupported", errorCode: "unsupported_request",
      model: { modelId: "gpt-5.4-mini", calls: 0, inputTokens: null, outputTokens: null, latencyMs: 1, estimatedCostMinor: null },
    }],
    ["error with outcomes", {
      ...emptyEngine, status: "error", errorCode: "provider_error",
      outcomes: [{ capabilityId: "dental-catalog", decisionKind: "answer", type: "catalog_answered", semanticClass: "information_authorized" }],
    }],
    ["error with final text", {
      ...emptyEngine, status: "error", errorCode: "provider_error",
      finalTextCharacters: 1, finalTextDigest: ref("8"),
    }],
    ["simulation with outcomes", {
      ...emptyEngine, status: "simulation_not_executed",
      capabilityIds: ["dental-scheduling"], decisionKinds: ["execute"],
      outcomes: [{ capabilityId: "dental-scheduling", decisionKind: "execute", type: "appointment_created", semanticClass: "effect_completed" }],
    }],
    ["simulation with final text", {
      ...emptyEngine, status: "simulation_not_executed",
      capabilityIds: ["dental-scheduling"], decisionKinds: ["execute"],
      finalTextCharacters: 1, finalTextDigest: ref("8"),
    }],
    ["no-safe-response with final text", {
      ...emptyEngine, status: "no_safe_response",
      finalTextCharacters: 1, finalTextDigest: ref("8"),
    }],
    ["observed without final digest", {
      ...observedV2, finalTextDigest: null,
    }],
    ["observed without final length", {
      ...observedV2, finalTextCharacters: null,
    }],
    ["observed with an error code", {
      ...observedV2, errorCode: "provider_error",
    }],
  ])("rejects impossible V2 status fields: %s", (_label, v2) => {
    expect(() => parseLiveComparisonRecord(live({ v2 }), new Set(["gpt-5.4-mini"])))
      .toThrow();
  });

  it("rejects unavailable on V2 even when V1 is also unavailable", () => {
    const unavailable = {
      ...emptyEngine,
      status: "unavailable",
      errorCode: "final_response_unavailable",
    };
    expect(() => parseLiveComparisonRecord(live({
      v1: unavailable,
      v2: unavailable,
      comparisonStatus: "not_measurable",
      comparisonReason: "v1_final_response_unavailable",
    }), new Set(["gpt-5.4-mini"]))).toThrow(/unavailable|V2|status/i);
  });

  it("accepts a structured outcome identity and rejects parallel outcome arrays", () => {
    const structured = {
      ...emptyEngine,
      status: "observed",
      understandingRequest: "price-of-service",
      capabilityIds: ["dental-catalog"],
      decisionKinds: ["answer"],
      outcomes: [{
        capabilityId: "dental-catalog",
        decisionKind: "answer",
        type: "catalog_answered",
        semanticClass: "information_authorized",
      }],
      finalTextCharacters: 12,
      finalTextDigest: ref("8"),
    };
    expect(parseLiveComparisonRecord(live({ v2: structured }), new Set(["gpt-5.4-mini"]))
      .v2).toMatchObject({ status: "observed", outcomes: structured.outcomes });
    const parallelArrays = {
      ...observedV2,
      outcomeTypes: ["catalog_answered"],
      semanticClasses: ["information_authorized"],
    } as Record<string, unknown>;
    delete parallelArrays.outcomes;
    expect(() => parseLiveComparisonRecord(live({ v2: parallelArrays }), new Set(["gpt-5.4-mini"])))
      .toThrow(/outcome|unrecognized|invalid/i);
  });

  it("requires every observed and no-safe outcome to align with one decision and owner", () => {
    const validNoSafe = {
      ...emptyEngine,
      status: "no_safe_response",
      capabilityIds: ["dental-catalog"],
      decisionKinds: ["answer"],
      outcomes: [{
        capabilityId: "dental-catalog",
        decisionKind: "answer",
        type: "catalog_answered",
        semanticClass: "information_authorized",
      }],
    };
    expect(parseLiveComparisonRecord(live({ v2: validNoSafe }), new Set(["gpt-5.4-mini"]))
      .v2.status).toBe("no_safe_response");

    for (const v2 of [
      { ...observedV2, decisionKinds: [] },
      { ...observedV2, decisionKinds: ["answer", "ask"] },
      {
        ...observedV2,
        outcomes: [{ ...observedV2.outcomes[0], decisionKind: "ask" }],
      },
      { ...observedV2, capabilityIds: ["dental-escalation"] },
      {
        ...observedV2,
        outcomes: [{
          capabilityId: "dental-catalog",
          decisionKind: "answer",
          type: "catalog_answered",
          semanticClass: "effect_completed",
        }],
      },
      {
        ...observedV2,
        capabilityIds: ["dental-catalog", "dental-catalog"],
        decisionKinds: ["answer", "answer"],
        outcomes: [observedV2.outcomes[0], observedV2.outcomes[0]],
      },
      { ...validNoSafe, decisionKinds: [] },
      { ...validNoSafe, capabilityIds: ["dental-escalation"] },
    ]) {
      expect(() => parseLiveComparisonRecord(live({ v2 }), new Set(["gpt-5.4-mini"])))
        .toThrow(/outcome|decision|capability|semantic|duplicate|invalid/i);
    }
  });

  it("closes intended effects to an aligned nonempty execute-only simulation", () => {
    const simulation = {
      ...emptyEngine,
      status: "simulation_not_executed",
      capabilityIds: ["dental-scheduling"],
      decisionKinds: ["execute"],
    };
    expect(parseLiveComparisonRecord(live({
      v2: simulation,
      intendedEffects: [intendedEffect],
    }), new Set(["gpt-5.4-mini"]))).toMatchObject({
      v2: { status: "simulation_not_executed" },
      intendedEffects: [intendedEffect],
    });

    for (const invalid of [
      { v2: simulation, intendedEffects: [] },
      { v2: { ...simulation, decisionKinds: ["answer"] }, intendedEffects: [intendedEffect] },
      { v2: { ...simulation, capabilityIds: ["dental-catalog"] }, intendedEffects: [intendedEffect] },
      ...[
        observedV2,
        { ...emptyEngine, status: "unsupported", errorCode: "unsupported_request" },
        { ...emptyEngine, status: "error", errorCode: "provider_error" },
        {
          ...emptyEngine,
          status: "no_safe_response",
          capabilityIds: ["dental-catalog"],
          decisionKinds: ["answer"],
          outcomes: observedV2.outcomes,
        },
      ].map((v2) => ({ v2, intendedEffects: [intendedEffect] })),
    ]) {
      expect(() => parseLiveComparisonRecord(live(invalid), new Set(["gpt-5.4-mini"])))
        .toThrow(/effect|simulation|execute|capability|invalid/i);
    }
  });

  it("requires positive final text and positive calls when model telemetry exists", () => {
    expect(() => parseLiveComparisonRecord(live({
      v1: { ...(live().v1 as Record<string, unknown>), finalTextCharacters: 0 },
    }), new Set(["gpt-5.4-mini"]))).toThrow(/greater|positive|characters|invalid/i);
    expect(() => parseLiveComparisonRecord(live({
      v1: {
        ...(live().v1 as Record<string, unknown>),
        model: { modelId: "gpt-5.4-mini", calls: 0, inputTokens: null, outputTokens: null, latencyMs: 0, estimatedCostMinor: null },
      },
    }), new Set(["gpt-5.4-mini"]))).toThrow(/greater|positive|calls|invalid/i);

    const postProviderUnsupported = {
      ...emptyEngine,
      status: "unsupported",
      errorCode: "unsupported_request",
      understandingRequest: "price-of-service",
      model: { modelId: "gpt-5.4-mini", calls: 1, inputTokens: null, outputTokens: null, latencyMs: 0, estimatedCostMinor: null },
    };
    expect(parseLiveComparisonRecord(live({ v2: postProviderUnsupported }), new Set(["gpt-5.4-mini"]))
      .v2).toEqual(postProviderUnsupported);
  });

  it("prechecks exact root keys and enforces snapshot budgets before deep copy", () => {
    const extraWithNestedAccessor = {};
    Object.defineProperty(extraWithNestedAccessor, "nested", {
      enumerable: true,
      get() { throw new Error("nested accessor must not be inspected"); },
    });
    expect(() => parseLiveComparisonRecord(live({ extra: extraWithNestedAccessor }), new Set(["gpt-5.4-mini"])))
      .toThrow(/exact.*keys|unexpected.*key/i);

    expect(() => parseLiveComparisonRecord(live({
      v2: {
        ...(live().v2 as Record<string, unknown>),
        capabilityIds: Array.from({ length: 10_001 }, () => "dental-scheduling"),
      },
    }), new Set(["gpt-5.4-mini"]))).toThrow(/budget|array|limit/i);

    let deep: unknown = "leaf";
    for (let index = 0; index < 40; index += 1) deep = { child: deep };
    expect(() => parseLiveComparisonRecord(live({ conversationRef: deep }), new Set(["gpt-5.4-mini"])))
      .toThrow(/budget|depth|limit/i);
  });

  it("rejects proxy, accessor and symbol input before executing property traps", () => {
    let reads = 0;
    const proxied = new Proxy(live(), {
      get(target, property, receiver) {
        reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => parseLiveComparisonRecord(proxied, new Set(["gpt-5.4-mini"])))
      .toThrow(/plain|proxy|record|invalid/i);
    expect(reads).toBe(0);

    const accessor = live();
    Object.defineProperty(accessor, "v2", {
      enumerable: true,
      get() {
        reads += 1;
        return observedV2;
      },
    });
    expect(() => parseLiveComparisonRecord(accessor, new Set(["gpt-5.4-mini"])))
      .toThrow(/plain|accessor|record|invalid/i);
    expect(reads).toBe(0);

    const symbol = { ...live(), [Symbol("hidden")]: "secret" };
    expect(() => parseLiveComparisonRecord(symbol, new Set(["gpt-5.4-mini"])))
      .toThrow(/plain|symbol|record|invalid/i);

    const nestedProxy = live({
      v2: new Proxy(observedV2, {
        get(target, property, receiver) {
          reads += 1;
          return Reflect.get(target, property, receiver);
        },
      }),
    });
    expect(() => parseLiveComparisonRecord(nestedProxy, new Set(["gpt-5.4-mini"])))
      .toThrow(/plain|proxy|record|invalid/i);
    expect(reads).toBe(0);

    const nestedAccessor = { ...observedV2 };
    Object.defineProperty(nestedAccessor, "outcomes", {
      enumerable: true,
      get() {
        reads += 1;
        return ["catalog_answered"];
      },
    });
    expect(() => parseLiveComparisonRecord(live({ v2: nestedAccessor }), new Set(["gpt-5.4-mini"])))
      .toThrow(/plain|accessor|record|invalid/i);
    expect(reads).toBe(0);
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
