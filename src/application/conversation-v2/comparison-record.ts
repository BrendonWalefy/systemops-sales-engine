import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Decision, OutcomeSemanticClass } from "@/conversation-core/decision";
import type { IntendedEffect } from "@/application/conversation-v2/dental-intended-effects";

export const LIVE_COMPARISON_VERSION = "conversation-v2-live-comparison.v1" as const;
export const APPROVED_EVAL_VERSION = "conversation-v2-approved-eval.v1" as const;

export type HmacRef = `hmac:${string}`;
export type ModelCallSummary = Readonly<{ modelId: string; calls: number; inputTokens: number | null; outputTokens: number | null; latencyMs: number; estimatedCostMinor: number | null }>;
export type EngineStructuralSummary = Readonly<{ status: "observed" | "unsupported" | "error" | "no_safe_response" | "simulation_not_executed"; understandingRequest: string | null; capabilityIds: readonly string[]; decisionKinds: readonly Decision["kind"][]; outcomeTypes: readonly string[]; semanticClasses: readonly OutcomeSemanticClass[]; finalTextCharacters: number | null; finalTextDigest: HmacRef | null; fallbackSource: "draft" | "repair" | "fallback" | null; errorCode: "provider_error" | "shared_read_unavailable" | "unknown_effect" | "unsupported_request" | null; model: ModelCallSummary | null }>;
export type LiveComparisonRecord = Readonly<{ version: typeof LIVE_COMPARISON_VERSION; turnRef: HmacRef; conversationRef: HmacRef | null; inputRef: HmacRef; occurredAt: string; commit: string; configDigest: HmacRef; datasetDigest: HmacRef | null; v1: EngineStructuralSummary; v2: EngineStructuralSummary; intendedEffects: readonly IntendedEffect[]; divergenceCodes: readonly ("request_mismatch" | "subject_mismatch" | "outcome_mismatch" | "critical_regression")[] }>;
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
const engineSummarySchema = z.object({
  status: z.enum(["observed", "unsupported", "error", "no_safe_response", "simulation_not_executed"]),
  understandingRequest: z.enum(requests).nullable(), capabilityIds: z.array(z.enum(capabilityIds)), decisionKinds: z.array(z.enum(decisionKinds)), outcomeTypes: z.array(z.enum(outcomeTypes)), semanticClasses: z.array(z.enum(semanticClasses)),
  finalTextCharacters: nullableNonNegativeInteger, finalTextDigest: hmacRef.nullable(), fallbackSource: z.enum(["draft", "repair", "fallback"]).nullable(), errorCode: z.enum(["provider_error", "shared_read_unavailable", "unknown_effect", "unsupported_request"]).nullable(), model: modelSchema.nullable(),
}).strict();
const intendedEffectSchema = z.discriminatedUnion("action", [
  z.object({ kind: z.literal("would_have_executed"), capabilityId: z.enum(capabilityIds), payloadHash: hmacHex, action: z.literal("book_slot"), payload: z.object({ slotRefHash: hmacHex }).strict() }).strict(),
  z.object({ kind: z.literal("would_have_executed"), capabilityId: z.enum(capabilityIds), payloadHash: hmacHex, action: z.literal("confirm_appointment"), payload: z.object({ appointmentRefHash: hmacHex }).strict() }).strict(),
]);
const liveSchema = z.object({ version: z.literal(LIVE_COMPARISON_VERSION), turnRef: hmacRef, conversationRef: hmacRef.nullable(), inputRef: hmacRef, occurredAt: isoDateTime, commit, configDigest: hmacRef, datasetDigest: hmacRef.nullable(), v1: engineSummarySchema, v2: engineSummarySchema, intendedEffects: z.array(intendedEffectSchema), divergenceCodes: z.array(z.enum(["request_mismatch", "subject_mismatch", "outcome_mismatch", "critical_regression"])) }).strict();
const evalSchema = z.object({ version: z.literal(APPROVED_EVAL_VERSION), run: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), caseId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{4}$/), arm: z.enum(["v1", "v2"]), snapshotDigest: hmacRef, outputText: z.string().min(1).max(20_000), source: z.discriminatedUnion("kind", [z.object({ kind: z.literal("committed_corpus"), corpusDigest: hmacRef }).strict(), z.object({ kind: z.literal("signed_replay"), datasetDigest: hmacRef, approvalDigest: hmacRef }).strict()]) }).strict();

function freeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value !== null && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze);
  return Object.freeze(value);
}

export function keyedRef(value: string, hmacKey: string): HmacRef {
  return `hmac:${createHmac("sha256", hmacKey).update(value).digest("hex")}`;
}

export function parseLiveComparisonRecord(input: unknown, allowedModelIds: ReadonlySet<string>): LiveComparisonRecord {
  const parsed = liveSchema.parse(input);
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
