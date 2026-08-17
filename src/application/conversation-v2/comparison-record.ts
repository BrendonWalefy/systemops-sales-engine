import { createHmac } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod";
import type { Decision, OutcomeSemanticClass } from "@/conversation-core/decision";
import type { IntendedEffect } from "@/application/conversation-v2/dental-intended-effects";

export const LIVE_COMPARISON_VERSION = "conversation-v2-live-comparison.v2" as const;
export const APPROVED_EVAL_VERSION = "conversation-v2-approved-eval.v1" as const;

export type HmacRef = `hmac:${string}`;
export type ModelCallSummary = Readonly<{ modelId: string; calls: number; inputTokens: number | null; outputTokens: number | null; latencyMs: number; estimatedCostMinor: number | null }>;
type ObservedEngineSummary = Readonly<{ status: "observed"; understandingRequest: string | null; capabilityIds: readonly string[]; decisionKinds: readonly Decision["kind"][]; outcomeTypes: readonly string[]; semanticClasses: readonly OutcomeSemanticClass[]; finalTextCharacters: number; finalTextDigest: HmacRef; fallbackSource: "draft" | "repair" | "fallback" | null; errorCode: null; model: ModelCallSummary | null }>;
type UnavailableV1EngineSummary = Readonly<{ status: "unavailable"; understandingRequest: null; capabilityIds: readonly never[]; decisionKinds: readonly never[]; outcomeTypes: readonly never[]; semanticClasses: readonly never[]; finalTextCharacters: null; finalTextDigest: null; fallbackSource: null; errorCode: "final_response_unavailable"; model: null }>;
type UnsupportedV2EngineSummary = Readonly<{ status: "unsupported"; understandingRequest: string | null; capabilityIds: readonly never[]; decisionKinds: readonly never[]; outcomeTypes: readonly never[]; semanticClasses: readonly never[]; finalTextCharacters: null; finalTextDigest: null; fallbackSource: null; errorCode: "shared_read_unavailable" | "unknown_effect" | "unsupported_request"; model: null }>;
type ErrorV2EngineSummary = Readonly<{ status: "error"; understandingRequest: string | null; capabilityIds: readonly never[]; decisionKinds: readonly never[]; outcomeTypes: readonly never[]; semanticClasses: readonly never[]; finalTextCharacters: null; finalTextDigest: null; fallbackSource: null; errorCode: "provider_error"; model: ModelCallSummary | null }>;
type NoSafeResponseV2EngineSummary = Readonly<{ status: "no_safe_response"; understandingRequest: string | null; capabilityIds: readonly string[]; decisionKinds: readonly Decision["kind"][]; outcomeTypes: readonly string[]; semanticClasses: readonly OutcomeSemanticClass[]; finalTextCharacters: null; finalTextDigest: null; fallbackSource: "draft" | "repair" | "fallback" | null; errorCode: null; model: ModelCallSummary | null }>;
type SimulationV2EngineSummary = Readonly<{ status: "simulation_not_executed"; understandingRequest: string | null; capabilityIds: readonly string[]; decisionKinds: readonly Decision["kind"][]; outcomeTypes: readonly never[]; semanticClasses: readonly never[]; finalTextCharacters: null; finalTextDigest: null; fallbackSource: null; errorCode: null; model: ModelCallSummary | null }>;
export type V1EngineStructuralSummary = ObservedEngineSummary | UnavailableV1EngineSummary;
export type V2EngineStructuralSummary = ObservedEngineSummary | UnsupportedV2EngineSummary | ErrorV2EngineSummary | NoSafeResponseV2EngineSummary | SimulationV2EngineSummary;
export type EngineStructuralSummary = V1EngineStructuralSummary | V2EngineStructuralSummary;
type LiveComparisonCommon = Readonly<{ version: typeof LIVE_COMPARISON_VERSION; turnRef: HmacRef; conversationRef: HmacRef | null; inputRef: HmacRef; occurredAt: string; commit: string; configDigest: HmacRef; datasetDigest: HmacRef | null; v2: V2EngineStructuralSummary; intendedEffects: readonly IntendedEffect[] }>;
export type LiveComparisonRecord =
  | (LiveComparisonCommon & Readonly<{ comparisonStatus: "comparable"; comparisonReason: null; v1: ObservedEngineSummary; divergenceCodes: readonly ("request_mismatch" | "subject_mismatch" | "outcome_mismatch" | "critical_regression")[] }>)
  | (LiveComparisonCommon & Readonly<{ comparisonStatus: "not_measurable"; comparisonReason: "v1_final_response_unavailable"; v1: UnavailableV1EngineSummary; divergenceCodes: readonly never[] }>);
export type ApprovedEvalRecord = Readonly<{ version: typeof APPROVED_EVAL_VERSION; run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; arm: "v1" | "v2"; snapshotDigest: HmacRef; outputText: string; source: Readonly<{ kind: "committed_corpus"; corpusDigest: HmacRef } | { kind: "signed_replay"; datasetDigest: HmacRef; approvalDigest: HmacRef }> }>;
export type ApprovedEvalPair = Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; pairDigest: HmacRef; snapshotDigest: HmacRef; v1: ApprovedEvalRecord & Readonly<{ arm: "v1" }>; v2: ApprovedEvalRecord & Readonly<{ arm: "v2" }> }>;

const hmacRef = z.string().regex(/^hmac:[a-f0-9]{64}$/, "invalid HmacRef");
const hmacHex = z.string().regex(/^[a-f0-9]{64}$/);
const isoDateTime = z.string().datetime({ offset: true }).refine((value) => !Number.isNaN(Date.parse(value)), "invalid ISO datetime");
const commit = z.string().regex(/^[a-f0-9]{7,64}$/);
const nonNegativeInteger = z.number().int().min(0);
const nullableNonNegativeInteger = nonNegativeInteger.nullable();
const requests = ["price-of-service", "service-availability", "book-appointment", "confirm-slot", "confirm-appointment"] as const;
const capabilityIds = ["dental-catalog", "dental-scheduling", "dental-escalation"] as const;
const decisionKinds = ["answer", "ask", "offer", "execute", "escalate", "close", "suppress"] as const;
const outcomeTypes = ["catalog_answered", "slots_found", "appointment_created", "appointment_confirmed", "appointment_create_failed", "appointment_confirmation_failed", "scheduling_failed", "escalation_required", "clarification_required"] as const;
const semanticClasses = ["information_authorized", "options_found", "effect_completed", "effect_failed", "human_action_required", "clarification_required"] as const;

const modelSchema = z.object({ modelId: z.string().min(1).max(128), calls: nonNegativeInteger, inputTokens: nullableNonNegativeInteger, outputTokens: nullableNonNegativeInteger, latencyMs: nonNegativeInteger, estimatedCostMinor: nullableNonNegativeInteger }).strict();
const emptyArray = z.array(z.never()).length(0);
const requestSchema = z.enum(requests).nullable();
const capabilityIdArray = z.array(z.enum(capabilityIds));
const decisionKindArray = z.array(z.enum(decisionKinds));
const outcomeTypeArray = z.array(z.enum(outcomeTypes));
const semanticClassArray = z.array(z.enum(semanticClasses));
const fallbackSourceSchema = z.enum(["draft", "repair", "fallback"]);
const observedEngineSchema = z.object({
  status: z.literal("observed"), understandingRequest: requestSchema,
  capabilityIds: capabilityIdArray, decisionKinds: decisionKindArray,
  outcomeTypes: outcomeTypeArray, semanticClasses: semanticClassArray,
  finalTextCharacters: nonNegativeInteger, finalTextDigest: hmacRef,
  fallbackSource: fallbackSourceSchema.nullable(), errorCode: z.null(),
  model: modelSchema.nullable(),
}).strict();
const unavailableV1EngineSchema = z.object({
  status: z.literal("unavailable"), understandingRequest: z.null(),
  capabilityIds: emptyArray, decisionKinds: emptyArray, outcomeTypes: emptyArray,
  semanticClasses: emptyArray, finalTextCharacters: z.null(), finalTextDigest: z.null(),
  fallbackSource: z.null(), errorCode: z.literal("final_response_unavailable"), model: z.null(),
}).strict();
const unsupportedV2EngineSchema = z.object({
  status: z.literal("unsupported"), understandingRequest: requestSchema,
  capabilityIds: emptyArray, decisionKinds: emptyArray, outcomeTypes: emptyArray,
  semanticClasses: emptyArray, finalTextCharacters: z.null(), finalTextDigest: z.null(),
  fallbackSource: z.null(),
  errorCode: z.enum(["shared_read_unavailable", "unknown_effect", "unsupported_request"]),
  model: z.null(),
}).strict();
const errorV2EngineSchema = z.object({
  status: z.literal("error"), understandingRequest: requestSchema,
  capabilityIds: emptyArray, decisionKinds: emptyArray, outcomeTypes: emptyArray,
  semanticClasses: emptyArray, finalTextCharacters: z.null(), finalTextDigest: z.null(),
  fallbackSource: z.null(), errorCode: z.literal("provider_error"), model: modelSchema.nullable(),
}).strict();
const noSafeResponseV2EngineSchema = z.object({
  status: z.literal("no_safe_response"), understandingRequest: requestSchema,
  capabilityIds: capabilityIdArray, decisionKinds: decisionKindArray,
  outcomeTypes: outcomeTypeArray, semanticClasses: semanticClassArray,
  finalTextCharacters: z.null(), finalTextDigest: z.null(),
  fallbackSource: fallbackSourceSchema.nullable(), errorCode: z.null(), model: modelSchema.nullable(),
}).strict();
const simulationV2EngineSchema = z.object({
  status: z.literal("simulation_not_executed"), understandingRequest: requestSchema,
  capabilityIds: capabilityIdArray.min(1), decisionKinds: decisionKindArray.min(1),
  outcomeTypes: emptyArray, semanticClasses: emptyArray,
  finalTextCharacters: z.null(), finalTextDigest: z.null(), fallbackSource: z.null(),
  errorCode: z.null(), model: modelSchema.nullable(),
}).strict();
const v2EngineSchema = z.discriminatedUnion("status", [
  observedEngineSchema,
  unsupportedV2EngineSchema,
  errorV2EngineSchema,
  noSafeResponseV2EngineSchema,
  simulationV2EngineSchema,
]);
const intendedEffectSchema = z.discriminatedUnion("action", [
  z.object({ kind: z.literal("would_have_executed"), capabilityId: z.enum(capabilityIds), payloadHash: hmacHex, action: z.literal("book_slot"), payload: z.object({ slotRefHash: hmacHex }).strict() }).strict(),
  z.object({ kind: z.literal("would_have_executed"), capabilityId: z.enum(capabilityIds), payloadHash: hmacHex, action: z.literal("confirm_appointment"), payload: z.object({ appointmentRefHash: hmacHex }).strict() }).strict(),
]);
const divergenceCode = z.enum(["request_mismatch", "subject_mismatch", "outcome_mismatch", "critical_regression"]);
const liveCommon = {
  version: z.literal(LIVE_COMPARISON_VERSION), turnRef: hmacRef,
  conversationRef: hmacRef.nullable(), inputRef: hmacRef, occurredAt: isoDateTime,
  commit, configDigest: hmacRef, datasetDigest: hmacRef.nullable(),
  v2: v2EngineSchema, intendedEffects: z.array(intendedEffectSchema),
} as const;
const comparableLiveSchema = z.object({
  ...liveCommon,
  comparisonStatus: z.literal("comparable"), comparisonReason: z.null(),
  v1: observedEngineSchema, divergenceCodes: z.array(divergenceCode),
}).strict();
const notMeasurableLiveSchema = z.object({
  ...liveCommon,
  comparisonStatus: z.literal("not_measurable"),
  comparisonReason: z.literal("v1_final_response_unavailable"),
  v1: unavailableV1EngineSchema, divergenceCodes: z.array(divergenceCode).length(0),
}).strict();
const liveSchema = z.discriminatedUnion("comparisonStatus", [
  comparableLiveSchema,
  notMeasurableLiveSchema,
]);
const evalSchema = z.object({ version: z.literal(APPROVED_EVAL_VERSION), run: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), caseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{4}$/), arm: z.enum(["v1", "v2"]), snapshotDigest: hmacRef, outputText: z.string().min(1).max(20_000), source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("committed_corpus"), corpusDigest: hmacRef }).strict(), z.object({ kind: z.literal("signed_replay"), datasetDigest: hmacRef, approvalDigest: hmacRef }).strict()]) }).strict();

function freeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value !== null && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze);
  return Object.freeze(value);
}

function snapshotPlainData(input: unknown, ancestors = new WeakSet<object>()): unknown {
  if (
    input === null
    || typeof input === "string"
    || typeof input === "number"
    || typeof input === "boolean"
  ) return input;
  if (typeof input !== "object" || isProxy(input)) {
    throw new Error("comparison record must contain plain data without proxies");
  }
  if (ancestors.has(input)) throw new Error("comparison record plain data cannot be cyclic");
  ancestors.add(input);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const ownKeys = Reflect.ownKeys(input);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new Error("comparison record plain data cannot contain symbol keys");
    }

    if (Array.isArray(input)) {
      if (Object.getPrototypeOf(input) !== Array.prototype) {
        throw new Error("comparison record arrays must use the plain Array prototype");
      }
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || !("value" in lengthDescriptor)) {
        throw new Error("comparison record array length must be a data property");
      }
      const length = lengthDescriptor.value;
      const output: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          throw new Error("comparison record arrays must be dense plain data");
        }
        output.push(snapshotPlainData(descriptor.value, ancestors));
      }
      const expectedKeys = new Set(["length", ...Array.from({ length }, (_, index) => String(index))]);
      if (ownKeys.some((key) => !expectedKeys.has(key as string))) {
        throw new Error("comparison record arrays cannot contain extra properties");
      }
      return output;
    }

    if (Object.getPrototypeOf(input) !== Object.prototype) {
      throw new Error("comparison record objects must use the plain Object prototype");
    }
    const output: Record<string, unknown> = {};
    for (const key of ownKeys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        throw new Error("comparison record objects cannot contain accessors or hidden properties");
      }
      Object.defineProperty(output, key, {
        value: snapshotPlainData(descriptor.value, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  } finally {
    ancestors.delete(input);
  }
}

export function keyedRef(value: string, hmacKey: string): HmacRef {
  return `hmac:${createHmac("sha256", hmacKey).update(value).digest("hex")}`;
}

export function parseLiveComparisonRecord(input: unknown, allowedModelIds: ReadonlySet<string>): LiveComparisonRecord {
  const parsed = liveSchema.parse(snapshotPlainData(input));
  for (const engine of [parsed.v1, parsed.v2]) if (engine.model && !allowedModelIds.has(engine.model.modelId)) throw new Error(`model is absent from the frozen run allowlist: ${engine.model.modelId}`);
  return freeze(parsed) as LiveComparisonRecord;
}

export function parseApprovedEvalRecord(input: unknown): ApprovedEvalRecord {
  return freeze(evalSchema.parse(input)) as ApprovedEvalRecord;
}

export function pairApprovedEvalRecords(records: readonly ApprovedEvalRecord[]): readonly ApprovedEvalPair[] {
  const byKey = new Map<string, { v1?: ApprovedEvalRecord; v2?: ApprovedEvalRecord }>();
  for (const input of records) {
    const record = parseApprovedEvalRecord(input);
    const key = `${record.run}:${record.caseId}`;
    const entry = byKey.get(key) ?? {};
    if (entry[record.arm]) throw new Error(`duplicate approved evaluation arm: ${key}:${record.arm}`);
    entry[record.arm] = record;
    byKey.set(key, entry);
  }
  const pairs: ApprovedEvalPair[] = [];
  for (const [key, entry] of byKey) {
    if (!entry.v1 || !entry.v2) throw new Error(`missing approved evaluation arm: ${key}`);
    if (entry.v1.snapshotDigest !== entry.v2.snapshotDigest) throw new Error(`snapshot mismatch: ${key}`);
    const [runText, caseId] = key.split(":") as [string, string];
    pairs.push(freeze({ run: Number(runText) as ApprovedEvalPair["run"], caseId, snapshotDigest: entry.v1.snapshotDigest, pairDigest: keyedRef(`${key}:${entry.v1.snapshotDigest}`, entry.v1.snapshotDigest), v1: entry.v1 as ApprovedEvalPair["v1"], v2: entry.v2 as ApprovedEvalPair["v2"] }));
  }
  return freeze(pairs.sort((a, b) => a.run - b.run || a.caseId.localeCompare(b.caseId)));
}
