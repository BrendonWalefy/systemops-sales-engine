import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";

import { z } from "zod";

import { measureProse } from "@/application/corpus/eval-prose";
import {
  assertSystemOpsLabRunId,
  SYSTEMOPS_LAB_PERSONA_EXPECTATIONS,
  type SystemOpsLabPersonaExpectation,
  type SystemOpsLabRunResult,
} from "@/application/labs/systemops-lab-persona";
import { isDentalOutcomeStructuralSummary } from "@/domain-packs/dental/outcome-provenance";

/**
 * Quem pode assinar as palavras entregues no estágio `response.validated` de um
 * turno do Lab: um modelo vivo, o renderizador determinístico, ou o mesmo
 * renderizador depois de o texto do modelo ser recusado. Uma identidade nova
 * precisa entrar aqui — o parser do evidence recusa qualquer outra.
 */
export const RESPONSE_VALIDATED_MODEL_IDS = [
  "gpt-4o-mini",
  "deterministic-v2",
  "deterministic-fallback",
] as const;

export type ResponseValidatedModelId = (typeof RESPONSE_VALIDATED_MODEL_IDS)[number];

export type SanitizedTranscriptMessage = Readonly<{
  turnId: string;
  messageId: string;
  author: "lead" | "agent";
  text: string;
}>;

type EngineSelectedTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "engine.selected";
  occurredAt: string;
  metadata: Readonly<{
    route: "v2";
    shadow: false;
    reason: "internal_lab_authorized";
  }>;
}>;

type UnderstandingTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "v2.understanding";
  occurredAt: string;
  metadata: Readonly<{
    status: "completed" | "failed";
    durationMs: number;
    modelId: "gpt-4o-mini";
    request: "price-of-service" | "service-availability" | "book-appointment"
      | "confirm-slot" | "confirm-appointment" | null;
  }>;
}>;

type DecisionTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "v2.decision";
  occurredAt: string;
  metadata: Readonly<{
    status: "prepared" | "suppressed" | "no_safe_response";
    durationMs: number;
    decisionCount: number;
    executeCount: number;
    capabilityIds: string;
    decisionKinds: string;
    intendedEffects: string;
  }>;
}>;

type ActionResultTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "v2.action_result";
  occurredAt: string;
  metadata: Readonly<{
    status: "completed" | "failed";
    durationMs: number;
    resultCount: number;
    completedEffectCount: number;
    failedEffectCount: number;
    outcomeTypes: string;
    semanticClasses: string;
  }>;
}>;

type ResponsePlanTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "response.plan_built";
  occurredAt: string;
  metadata: Readonly<{
    action: string;
    planVersion: string;
    allowedPriceCount: number;
    allowedScheduleFactCount: number;
    allowedMediaCount: number;
    outcomeRefs: string;
    evidenceRefs: string;
    outcomeCount: number;
    factCount: number;
    optionCount: number;
    subjectCount: number;
    evidenceCount: number;
  }>;
}>;

type ResponseValidatedTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "response.validated";
  occurredAt: string;
  metadata: Readonly<{
    action: string;
    valid: boolean;
    violationCount: number;
    violations: string;
    requiresHandoff: boolean;
    model?: ResponseValidatedModelId;
    promptVersion?: string;
    inputTokens?: number | null;
    outputTokens?: number | null;
    latencyMs?: number;
    costMicros?: number | null;
    source: "draft" | "repair" | "fallback" | "none";
    verbalizationViolations?: string;
  }>;
}>;

type ResponseFallbackTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "response.fallback_applied";
  occurredAt: string;
  metadata: Readonly<{
    action: string;
    fallbackReason: string;
    requiresHandoff: boolean;
  }>;
}>;

type OutboxTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "v2.outbox";
  occurredAt: string;
  metadata: Readonly<{
    status: "enqueued" | "failed";
    durationMs: number;
    messageWasNew: boolean;
    jobWasNew: boolean;
  }>;
}>;

type DeliveryTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "delivery.sent";
  occurredAt: string;
  metadata: Readonly<{ status: "captured" }>;
}>;

type FailureTrace = Readonly<{
  schemaVersion: "decision-trace.v1";
  turnId: string;
  sequence: number;
  stage: "turn.failed";
  occurredAt: string;
  metadata: Readonly<{
    phase: "understanding" | "decision" | "action" | "response" | "outbox";
    reason: "understanding_failed" | "decision_failed" | "action_failed"
      | "response_validation_failed" | "outbox_failed";
    effectAttempted: boolean;
    effectCompleted: boolean;
  }>;
}>;

export type SanitizedLabTraceEvent = EngineSelectedTrace
  | UnderstandingTrace
  | DecisionTrace
  | ActionResultTrace
  | ResponsePlanTrace
  | ResponseValidatedTrace
  | ResponseFallbackTrace
  | OutboxTrace
  | DeliveryTrace
  | FailureTrace;

export type SystemOpsLabEvaluation = Readonly<{
  schemaVersion: 1;
  runId: string;
  personaId: string;
  automatedStatus: "pass" | "fail" | "not_measurable";
  checks: readonly Readonly<{
    id: SystemOpsLabPersonaExpectation;
    status: "pass" | "fail" | "not_measurable";
    evidence: readonly string[];
  }>[];
  humanReview: "pending";
  ownerReview: "pending";
}>;

const nonEmptySafeString = z.string().min(1).max(240);
const nonNegativeInteger = z.number().int().min(0);
function closedCsv(
  values: readonly string[],
  allowEmpty = false,
  requireUnique = false,
): z.ZodType<string> {
  const allowed = new Set(values);
  return z.string().max(1_000).superRefine((value, context) => {
    const items = value.length === 0 ? [] : value.split(",");
    if ((!allowEmpty && items.length === 0)
      || (requireUnique && new Set(items).size !== items.length)
      || items.some((item) => !allowed.has(item))) {
      context.addIssue({ code: "custom", message: "value is outside the closed CSV allowlist" });
    }
  });
}
const capabilityIdsCsv = closedCsv([
  "dental-catalog", "dental-scheduling", "dental-escalation",
], true, true);
const decisionKindsCsv = closedCsv([
  "answer", "ask", "offer", "execute", "escalate", "close", "suppress",
], true);
const intendedEffectsCsv = closedCsv([
  "none", "book_slot", "confirm_appointment", "persist_slot_offer",
], true);
const outcomeTypesCsv = closedCsv([
  "catalog_answered", "slots_found", "appointment_created", "appointment_confirmed",
  "appointment_create_failed", "appointment_confirmation_failed", "scheduling_failed",
  "escalation_required", "clarification_required",
], true);
const semanticClassesCsv = closedCsv([
  "information_authorized", "options_found", "effect_completed", "effect_failed",
  "human_action_required", "clarification_required",
], true);
const outcomeRefsCsv = z.string().regex(/^outcome-\d+(?:,outcome-\d+)*$/);
const evidenceRefsCsv = z.string().regex(/^(?:evidence-\d+(?:,evidence-\d+)*)?$/);
const traceBase = {
  schemaVersion: z.literal("decision-trace.v1"),
  turnId: nonEmptySafeString,
  sequence: nonNegativeInteger,
  occurredAt: z.string().datetime({ offset: true }),
};

const traceSchema = z.discriminatedUnion("stage", [
  z.object({
    ...traceBase,
    stage: z.literal("engine.selected"),
    metadata: z.object({
      route: z.literal("v2"),
      shadow: z.literal(false),
      reason: z.literal("internal_lab_authorized"),
    }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("v2.understanding"),
    metadata: z.object({
      status: z.enum(["completed", "failed"]),
      durationMs: nonNegativeInteger,
      modelId: z.literal("gpt-4o-mini"),
      request: z.enum([
        "price-of-service",
        "service-availability",
        "book-appointment",
        "confirm-slot",
        "confirm-appointment",
      ]).nullable(),
    }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("v2.decision"),
    metadata: z.object({
      status: z.enum(["prepared", "suppressed", "no_safe_response"]),
      durationMs: nonNegativeInteger,
      decisionCount: nonNegativeInteger,
      executeCount: nonNegativeInteger,
      capabilityIds: capabilityIdsCsv,
      decisionKinds: decisionKindsCsv,
      intendedEffects: intendedEffectsCsv,
    }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("v2.action_result"),
    metadata: z.object({
      status: z.enum(["completed", "failed"]),
      durationMs: nonNegativeInteger,
      resultCount: nonNegativeInteger,
      completedEffectCount: nonNegativeInteger,
      failedEffectCount: nonNegativeInteger,
      outcomeTypes: outcomeTypesCsv,
      semanticClasses: semanticClassesCsv,
    }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("response.plan_built"),
    metadata: z.object({
      action: z.literal("v2_response"),
      planVersion: z.literal("authorized-response-plan.v2"),
      allowedPriceCount: nonNegativeInteger,
      allowedScheduleFactCount: nonNegativeInteger,
      allowedMediaCount: z.literal(0),
      outcomeRefs: outcomeRefsCsv,
      evidenceRefs: evidenceRefsCsv,
      outcomeCount: nonNegativeInteger,
      factCount: nonNegativeInteger,
      optionCount: nonNegativeInteger,
      subjectCount: nonNegativeInteger,
      evidenceCount: nonNegativeInteger,
    }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("response.validated"),
    metadata: z.object({
      action: z.literal("v2_response"),
      valid: z.boolean(),
      violationCount: nonNegativeInteger,
      violations: z.string().max(1_000),
      requiresHandoff: z.boolean(),
      model: z.enum(RESPONSE_VALIDATED_MODEL_IDS).optional(),
      promptVersion: nonEmptySafeString.optional(),
      inputTokens: nonNegativeInteger.nullable().optional(),
      outputTokens: nonNegativeInteger.nullable().optional(),
      latencyMs: nonNegativeInteger.optional(),
      costMicros: nonNegativeInteger.nullable().optional(),
      source: z.enum(["draft", "repair", "fallback", "none"]),
      verbalizationViolations: z.string().max(500).optional(),
    }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("response.fallback_applied"),
    metadata: z.object({
      action: z.literal("v2_response"),
      fallbackReason: z.enum(["composer_error", "response_plan_violation", "safe_fallback"]),
      requiresHandoff: z.boolean(),
    }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("v2.outbox"),
    metadata: z.object({
      status: z.enum(["enqueued", "failed"]),
      durationMs: nonNegativeInteger,
      messageWasNew: z.boolean(),
      jobWasNew: z.boolean(),
    }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("delivery.sent"),
    metadata: z.object({ status: z.literal("captured") }).strict(),
  }).strict(),
  z.object({
    ...traceBase,
    stage: z.literal("turn.failed"),
    metadata: z.object({
      phase: z.enum(["understanding", "decision", "action", "response", "outbox"]),
      reason: z.enum([
        "understanding_failed",
        "decision_failed",
        "action_failed",
        "response_validation_failed",
        "outbox_failed",
      ]),
      effectAttempted: z.boolean(),
      effectCompleted: z.boolean(),
    }).strict(),
  }).strict(),
]);

const runSchema = z.object({
  runId: nonEmptySafeString,
  clinicId: z.string().uuid(),
  personaId: nonEmptySafeString,
  conversationId: nonEmptySafeString,
  turns: z.array(z.object({
    turnId: nonEmptySafeString,
    leadMessageId: nonEmptySafeString,
    outboundMessageId: nonEmptySafeString,
    persistedAgentMessageId: nonEmptySafeString,
    captured: z.literal(true),
  }).strict()).min(1).max(8),
}).strict();

const messageSchema = z.object({
  turnId: nonEmptySafeString,
  messageId: nonEmptySafeString,
  author: z.enum(["lead", "agent"]),
  text: z.string().min(1).max(4_000),
}).strict();

const scenarios = Object.freeze({
  "price-scheduling": "price_scheduling",
  "objection-escalation": "objection_escalation",
  "booking-revalidation": "booking_revalidation",
} as const);

const violationCodes = new Set([
  "invalid_draft_shape",
  "unknown_outcome_ref",
  "unknown_fact_ref",
  "unknown_subject_ref",
  "unknown_option_ref",
  "fact_outcome_mismatch",
  "option_outcome_mismatch",
  "subject_mismatch",
  "fact_not_disclosable",
  "empty_draft",
  "empty_reference_set",
  "duplicate_reference",
  "incompatible_speech_act",
  "empty_response",
  "response_too_long",
  "too_many_questions",
  "unauthorized_media",
  "unauthorized_price",
  "unauthorized_schedule_fact",
  "unsupported_guarantee",
  "unauthorized_service",
  "service_price_mismatch",
  "no_valid_draft",
  "render_failed",
]);

const traceStageOrder: Readonly<Record<SanitizedLabTraceEvent["stage"], number>> = Object.freeze({
  "engine.selected": 0,
  "v2.understanding": 1,
  "v2.decision": 2,
  "v2.action_result": 3,
  "response.plan_built": 4,
  "response.validated": 5,
  "response.fallback_applied": 6,
  "v2.outbox": 7,
  "delivery.sent": 8,
  "turn.failed": 9,
});

const unsafePatterns: readonly Readonly<{ label: string; pattern: RegExp }>[] = Object.freeze([
  Object.freeze({ label: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i }),
  Object.freeze({
    label: "phone",
    pattern: /(?:\+\d{10,15}\b|\(\d{2,3}\)\s*\d{4,5}[ .-]?\d{4}\b|\b\d{2,3}[ .-]\d{4,5}[ .-]\d{4}\b|\b\d{10,15}\b)/,
  }),
  Object.freeze({ label: "CPF", pattern: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/ }),
  Object.freeze({ label: "OpenAI secret", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/ }),
  Object.freeze({
    label: "service token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/,
  }),
  Object.freeze({
    label: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  }),
  Object.freeze({
    label: "private key",
    pattern: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/,
  }),
  Object.freeze({
    label: "credential",
    pattern: /\b(?:api[_-]?key|client[_-]?secret|secret|password|authorization|bearer)["']?\s*[:=]\s*["']?\S+/i,
  }),
  Object.freeze({
    label: "provider payload",
    pattern: /\b(?:providerPayload|rawPayload|requestBody|responseBody|prompt|completion|headers)["']?\s*[:=]/i,
  }),
  Object.freeze({
    label: "opaque identifier",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  }),
]);

type ParsedRun = z.infer<typeof runSchema>;
type ParsedMessage = z.infer<typeof messageSchema>;
type ParsedTrace = z.infer<typeof traceSchema>;
type CheckStatus = SystemOpsLabEvaluation["checks"][number]["status"];
type EvaluationCheck = SystemOpsLabEvaluation["checks"][number];

function assertSafeArtifactText(text: string): void {
  assertNoPrivateUrl(text);
  const unsafe = unsafePatterns.find(({ pattern }) => pattern.test(text));
  if (unsafe) throw new Error(`SystemOps Lab evidence contains unsafe sensitive ${unsafe.label}`);
}

function mappedIpv4(host: string): string | null {
  if (!host.startsWith("::ffff:") && !host.startsWith("::")) return null;
  const tail = host.startsWith("::ffff:") ? host.slice(7) : host.slice(2);
  if (isIP(tail) === 4) return tail;
  const groups = tail.split(":");
  if (groups.length !== 2 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return null;
  }
  const high = Number.parseInt(groups[0]!, 16);
  const low = Number.parseInt(groups[1]!, 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second, third] = octets as [number, number, number, number];
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
    || (first === 203 && second === 0 && third === 113)
    || first >= 224;
}

function isPrivateHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
  ) return true;
  if (isIP(hostname) === 4) return isPrivateIpv4(hostname);
  if (isIP(hostname) !== 6) return false;
  const firstHextet = Number.parseInt(hostname.split(":")[0] || "0", 16);
  const embeddedIpv4 = mappedIpv4(hostname);
  return hostname === "::"
    || hostname === "::1"
    || /^(?:0:){7}1$/.test(hostname)
    || (firstHextet & 0xfe00) === 0xfc00
    || (firstHextet & 0xffc0) === 0xfe80
    || (firstHextet & 0xff00) === 0xff00
    || hostname.startsWith("2001:db8:")
    || (embeddedIpv4 !== null && isPrivateIpv4(embeddedIpv4));
}

function assertNoPrivateUrl(text: string): void {
  const normalized = text.replace(/\\\//g, "/");
  const candidates = normalized.match(
    /[a-z][a-z0-9+.-]*:\/\/(?:\[[^\]]+\]|[^\s/"'<>]+)(?::\d+)?[^\s"'<>]*/gi,
  ) ?? [];
  for (const candidate of candidates) {
    try {
      if (isPrivateHostname(new URL(candidate).hostname)) {
        throw new Error("SystemOps Lab evidence contains unsafe sensitive private URL");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("private URL")) throw error;
      // A malformed URL is not treated as a URL; the remaining scanners still
      // inspect its raw text for credentials, provider payloads and PII.
    }
  }
}

function parseViolations(event: ParsedTrace): ReadonlySet<string> {
  if (event.stage !== "response.validated") return new Set();
  const parsed = event.metadata.violations
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (new Set(parsed).size !== parsed.length || parsed.some((code) => !violationCodes.has(code))) {
    throw new Error("SystemOps Lab trace contains a non-allowlisted validator violation");
  }
  if (parsed.length !== event.metadata.violationCount) {
    throw new Error("SystemOps Lab trace validator violation count is inconsistent");
  }
  if (event.metadata.valid !== (parsed.length === 0)) {
    throw new Error("SystemOps Lab trace validator status is inconsistent");
  }
  return new Set(parsed);
}

function canonicalizeInput(input: Readonly<{
  run: SystemOpsLabRunResult;
  messages: readonly SanitizedTranscriptMessage[];
  trace: readonly SanitizedLabTraceEvent[];
}>): Readonly<{
  run: ParsedRun;
  messages: readonly ParsedMessage[];
  trace: readonly ParsedTrace[];
  turnRefs: ReadonlyMap<string, string>;
}> {
  const parsedRun = runSchema.parse(input.run);
  assertSystemOpsLabRunId(parsedRun.runId);
  if (!(parsedRun.personaId in scenarios)) {
    throw new Error("SystemOps Lab evidence persona is outside the closed Lab set");
  }
  const parsedMessages = z.array(messageSchema).parse(input.messages);
  const parsedTraceResult = z.array(traceSchema).safeParse(input.trace);
  if (!parsedTraceResult.success) {
    throw new Error("SystemOps Lab trace violates the sanitized field allowlist");
  }
  const parsedTrace = parsedTraceResult.data;
  const turnRefs = new Map(parsedRun.turns.map((turn, index) => [turn.turnId, `turn-${index + 1}`]));
  if (turnRefs.size !== parsedRun.turns.length) {
    throw new Error("SystemOps Lab evidence contains duplicate run turns");
  }

  const expectedMessageIds: string[] = [];
  for (const turn of parsedRun.turns) {
    expectedMessageIds.push(turn.leadMessageId, turn.persistedAgentMessageId);
  }
  if (
    parsedMessages.length !== expectedMessageIds.length
    || parsedMessages.some((message, index) => message.messageId !== expectedMessageIds[index])
  ) throw new Error("SystemOps Lab evidence messages are not the persisted run messages in order");
  for (let index = 0; index < parsedRun.turns.length; index += 1) {
    const turn = parsedRun.turns[index]!;
    const lead = parsedMessages[index * 2]!;
    const agent = parsedMessages[(index * 2) + 1]!;
    if (
      lead.turnId !== turn.turnId
      || lead.author !== "lead"
      || agent.turnId !== turn.turnId
      || agent.author !== "agent"
    ) throw new Error("SystemOps Lab evidence messages are not lead-agent paired by run turn");
  }
  for (const message of parsedMessages) assertSafeArtifactText(message.text);

  const stageByTurn = new Set<string>();
  const lastSequenceByTurn = new Map<string, number>();
  const lastStageOrderByTurn = new Map<string, number>();
  for (const event of parsedTrace) {
    if (!turnRefs.has(event.turnId)) {
      throw new Error("SystemOps Lab trace references a turn outside the run");
    }
    const identity = `${event.turnId}:${event.stage}`;
    if (stageByTurn.has(identity)) {
      throw new Error("SystemOps Lab trace contains a duplicate stage for one turn");
    }
    stageByTurn.add(identity);
    const previous = lastSequenceByTurn.get(event.turnId);
    if (previous !== undefined && event.sequence <= previous) {
      throw new Error("SystemOps Lab trace sequence is not strictly increasing per turn");
    }
    lastSequenceByTurn.set(event.turnId, event.sequence);
    const previousStageOrder = lastStageOrderByTurn.get(event.turnId);
    const stageOrder = traceStageOrder[event.stage];
    if (previousStageOrder !== undefined && stageOrder <= previousStageOrder) {
      throw new Error("SystemOps Lab trace stage order is invalid");
    }
    lastStageOrderByTurn.set(event.turnId, stageOrder);
    parseViolations(event);
    assertSafeArtifactText(JSON.stringify({
      occurredAt: event.occurredAt,
      stage: event.stage,
      metadata: event.metadata,
    }));
  }
  for (const turn of parsedRun.turns) {
    const events = parsedTrace.filter((event) => event.turnId === turn.turnId);
    const understanding = events.find((event) => event.stage === "v2.understanding");
    if (understanding?.stage === "v2.understanding"
      && ((understanding.metadata.status === "completed" && understanding.metadata.request === null)
        || (understanding.metadata.status === "failed" && understanding.metadata.request !== null))) {
      throw new Error("SystemOps Lab trace understanding status is inconsistent");
    }
    const decision = events.find((event) => event.stage === "v2.decision");
    if (decision?.stage === "v2.decision") {
      const capabilityCount = decision.metadata.capabilityIds
        ? decision.metadata.capabilityIds.split(",").length : 0;
      const kindCount = decision.metadata.decisionKinds
        ? decision.metadata.decisionKinds.split(",").length : 0;
      const intendedEffectCount = decision.metadata.intendedEffects
        ? decision.metadata.intendedEffects.split(",").length : 0;
      const decisionKinds = decision.metadata.decisionKinds
        ? decision.metadata.decisionKinds.split(",") : [];
      const intendedEffects = decision.metadata.intendedEffects
        ? decision.metadata.intendedEffects.split(",") : [];
      const effectKindsMatch = decisionKinds.every((kind, index) => {
        const effect = intendedEffects[index];
        if (kind === "execute") {
          return effect === "book_slot" || effect === "confirm_appointment";
        }
        if (kind === "offer") return effect === "persist_slot_offer";
        return effect === "none";
      });
      if (
        decision.metadata.executeCount > decision.metadata.decisionCount
        || decision.metadata.executeCount
          !== decisionKinds.filter((kind) => kind === "execute").length
        || capabilityCount !== decision.metadata.decisionCount
        || kindCount !== decision.metadata.decisionCount
        || intendedEffectCount !== decision.metadata.decisionCount
        || !effectKindsMatch
      ) throw new Error("SystemOps Lab trace decision counts are inconsistent");
    }
    const action = events.find((event) => event.stage === "v2.action_result");
    if (action?.stage === "v2.action_result") {
      const outcomeCount = action.metadata.outcomeTypes
        ? action.metadata.outcomeTypes.split(",").length : 0;
      const semanticCount = action.metadata.semanticClasses
        ? action.metadata.semanticClasses.split(",").length : 0;
      const outcomeTypes = action.metadata.outcomeTypes
        ? action.metadata.outcomeTypes.split(",") : [];
      const semanticClasses = action.metadata.semanticClasses
        ? action.metadata.semanticClasses.split(",") : [];
      const decisionCapabilities = decision?.stage === "v2.decision"
        ? decision.metadata.capabilityIds.split(",") : [];
      const decisionKinds = decision?.stage === "v2.decision"
        ? decision.metadata.decisionKinds.split(",") : [];
      const intendedEffects = decision?.stage === "v2.decision"
        ? decision.metadata.intendedEffects.split(",") : [];
      const expectedSemanticClass: Readonly<Record<string, string>> = {
        catalog_answered: "information_authorized",
        slots_found: "options_found",
        appointment_created: "effect_completed",
        appointment_confirmed: "effect_completed",
        appointment_create_failed: "effect_failed",
        appointment_confirmation_failed: "effect_failed",
        scheduling_failed: "effect_failed",
        escalation_required: "human_action_required",
        clarification_required: "clarification_required",
      };
      const completedEffectCount = outcomeTypes.filter((type) =>
        type === "slots_found"
        || type === "appointment_created"
        || type === "appointment_confirmed").length;
      const failedEffectCount = outcomeTypes.filter((type) =>
        expectedSemanticClass[type] === "effect_failed").length;
      const outcomeProvenanceMatches = decision?.stage !== "v2.decision"
        || outcomeTypes.every((type, index) => {
          const decisionKind = decisionKinds[index];
          const base = {
            capabilityId: decisionCapabilities[index],
            decisionKind,
            type,
            semanticClass: semanticClasses[index],
          };
          return isDentalOutcomeStructuralSummary(decisionKind === "execute"
            ? { ...base, action: intendedEffects[index] }
            : base);
        });
      if (
        action.metadata.completedEffectCount + action.metadata.failedEffectCount
          > action.metadata.resultCount
        || outcomeCount !== action.metadata.resultCount
        || semanticCount !== action.metadata.resultCount
        || outcomeTypes.some((type, index) =>
          expectedSemanticClass[type] !== semanticClasses[index])
        || action.metadata.completedEffectCount !== completedEffectCount
        || action.metadata.failedEffectCount !== failedEffectCount
        || !outcomeProvenanceMatches
        || (decision?.stage === "v2.decision"
          && decision.metadata.decisionCount !== action.metadata.resultCount)
      ) throw new Error("SystemOps Lab trace action-result counts or provenance are inconsistent");
    }
    const plan = events.find((event) => event.stage === "response.plan_built");
    const validator = events.find((event) => event.stage === "response.validated");
    const fallback = events.find((event) => event.stage === "response.fallback_applied");
    if (plan?.stage === "response.plan_built" && validator?.stage === "response.validated"
      && plan.metadata.action !== validator.metadata.action) {
      throw new Error("SystemOps Lab trace plan and validator actions are inconsistent");
    }
    if (plan?.stage === "response.plan_built" && (
      !hasCanonicalIndexedRefs(plan.metadata.outcomeRefs, "outcome", plan.metadata.outcomeCount)
      || !hasCanonicalIndexedRefs(
        plan.metadata.evidenceRefs,
        "evidence",
        plan.metadata.evidenceCount,
      )
      || plan.metadata.allowedPriceCount + plan.metadata.allowedScheduleFactCount
        > plan.metadata.factCount
      || (action?.stage === "v2.action_result"
        && plan.metadata.outcomeCount !== action.metadata.resultCount)
    )) throw new Error("SystemOps Lab trace authorized plan counts are inconsistent");
    if (validator?.stage === "response.validated" && (
      (validator.metadata.valid && validator.metadata.source === "none")
      || (!validator.metadata.valid && validator.metadata.source !== "none")
      || (validator.metadata.source === "fallback") !== Boolean(fallback)
    )) throw new Error("SystemOps Lab trace final validator source is inconsistent");
  }

  return Object.freeze({
    run: parsedRun,
    messages: Object.freeze(parsedMessages),
    trace: Object.freeze(parsedTrace),
    turnRefs,
  });
}

function traceEvidenceRef(event: ParsedTrace, turnRefs: ReadonlyMap<string, string>): string {
  return `trace:${turnRefs.get(event.turnId)!}:${event.stage}:${event.sequence}`;
}

function messageEvidenceRef(
  message: ParsedMessage,
  turnRefs: ReadonlyMap<string, string>,
): string {
  return `message:${turnRefs.get(message.turnId)!}:${message.author}`;
}

function hasCanonicalIndexedRefs(value: string, prefix: string, count: number): boolean {
  return value === Array.from({ length: count }, (_, index) => `${prefix}-${index}`).join(",");
}

function evaluate(input: ReturnType<typeof canonicalizeInput>): SystemOpsLabEvaluation {
  const eventsByTurn = new Map(input.run.turns.map((turn) => [
    turn.turnId,
    input.trace.filter((event) => event.turnId === turn.turnId),
  ]));
  const messageByTurn = new Map(input.run.turns.map((turn, index) => [
    turn.turnId,
    { lead: input.messages[index * 2]!, agent: input.messages[(index * 2) + 1]! },
  ]));

  const event = <Stage extends ParsedTrace["stage"]>(turnId: string, stage: Stage) =>
    eventsByTurn.get(turnId)?.find((candidate) => candidate.stage === stage) as
      Extract<ParsedTrace, { stage: Stage }> | undefined;
  const eventRef = (value: ParsedTrace) => traceEvidenceRef(value, input.turnRefs);
  const agentRef = (turnId: string) => messageEvidenceRef(
    messageByTurn.get(turnId)!.agent,
    input.turnRefs,
  );
  const validators = input.run.turns.flatMap((turn) => {
    const validator = event(turn.turnId, "response.validated");
    const plan = event(turn.turnId, "response.plan_built");
    const fallback = event(turn.turnId, "response.fallback_applied");
    return validator && plan && !fallback ? [{ turnId: turn.turnId, plan, validator }] : [];
  });

  const check = (
    id: SystemOpsLabPersonaExpectation,
    status: CheckStatus,
    evidence: readonly string[],
  ): EvaluationCheck => Object.freeze({ id, status, evidence: Object.freeze([...evidence]) });
  const completeValidators = validators.length === input.run.turns.length;
  const invalid = validators.filter(({ validator }) => !validator.metadata.valid);
  const invalidWith = (codes: ReadonlySet<string>) => invalid.filter(({ validator }) =>
    [...parseViolations(validator)].some((code) => codes.has(code)));
  const refsForValidators = (values: typeof validators) => values.flatMap(
    ({ turnId, plan, validator }) => [eventRef(plan), eventRef(validator), agentRef(turnId)],
  );

  const factualCodes = new Set([
    "unknown_fact_ref",
    "fact_outcome_mismatch",
    "fact_not_disclosable",
    "unauthorized_price",
    "unauthorized_service",
    "service_price_mismatch",
    "unsupported_guarantee",
  ]);
  const factualFailures = invalidWith(factualCodes);
  const factual = factualFailures.length > 0
    ? check("factual_correctness", "fail", refsForValidators(factualFailures))
    : completeValidators && invalid.length === 0
      ? check("factual_correctness", "pass", refsForValidators(validators))
      : check("factual_correctness", "not_measurable", []);

  const unauthorizedCodes = new Set([
    "unknown_fact_ref",
    "fact_not_disclosable",
    "unauthorized_price",
    "unauthorized_service",
    "unsupported_guarantee",
  ]);
  const unauthorizedFailures = invalidWith(unauthorizedCodes);
  const unauthorized = unauthorizedFailures.length > 0
    ? check("unauthorized_facts", "fail", refsForValidators(unauthorizedFailures))
    : completeValidators && invalid.length === 0
      ? check("unauthorized_facts", "pass", refsForValidators(validators))
      : check("unauthorized_facts", "not_measurable", []);

  const priceTurns = input.run.turns.flatMap((turn) => {
    const agent = messageByTurn.get(turn.turnId)!.agent;
    const metrics = measureProse({ text: agent.text, history: [], authorizedPriceCents: [] });
    const validator = event(turn.turnId, "response.validated");
    const fallback = event(turn.turnId, "response.fallback_applied");
    const plan = event(turn.turnId, "response.plan_built");
    const action = event(turn.turnId, "v2.action_result");
    const violations = validator ? parseViolations(validator) : new Set<string>();
    if (fallback) return [];
    const hasPriceContext = metrics.quotedPriceCents.length > 0
      || violations.has("service_price_mismatch")
      || violations.has("unauthorized_price");
    return hasPriceContext
      ? [{ turnId: turn.turnId, action, validator, plan, metrics, violations }]
      : [];
  });
  const priceFailures = priceTurns.filter(({ violations }) =>
    violations.has("subject_mismatch")
    || violations.has("service_price_mismatch")
    || violations.has("unauthorized_price"));
  const priceBinding = priceFailures.length > 0
    ? check("price_subject_binding", "fail", priceFailures.flatMap(({ turnId, validator }) =>
      validator ? [eventRef(validator), agentRef(turnId)] : [agentRef(turnId)]))
    : priceTurns.length > 0 && priceTurns.every(({ action, plan, validator }) =>
      action?.metadata.outcomeTypes.split(",").includes("catalog_answered")
      && plan && plan.metadata.allowedPriceCount > 0 && validator?.metadata.valid === true)
      ? check("price_subject_binding", "pass", priceTurns.flatMap(
        ({ turnId, action, plan, validator }) =>
          [eventRef(action!), eventRef(plan!), eventRef(validator!), agentRef(turnId)],
      ))
      : check("price_subject_binding", "not_measurable", []);

  const schedulingRequests = new Set([
    "service-availability",
    "book-appointment",
    "confirm-slot",
    "confirm-appointment",
  ]);
  const schedulingTurns = input.run.turns.flatMap((turn) => {
    const understanding = event(turn.turnId, "v2.understanding");
    if (!understanding || !understanding.metadata.request
      || !schedulingRequests.has(understanding.metadata.request)) return [];
    if (event(turn.turnId, "response.fallback_applied")) return [];
    return [{
      turnId: turn.turnId,
      understanding,
      action: event(turn.turnId, "v2.action_result"),
      plan: event(turn.turnId, "response.plan_built"),
      validator: event(turn.turnId, "response.validated"),
    }];
  });
  const schedulingFailures = schedulingTurns.filter(({ action, validator }) =>
    action?.metadata.status === "failed"
    || (validator && parseViolations(validator).has("unauthorized_schedule_fact")));
  const scheduling = schedulingFailures.length > 0
    ? check("scheduling_correctness", "fail", schedulingFailures.flatMap((value) => [
      eventRef(value.understanding),
      ...(value.action ? [eventRef(value.action)] : []),
      ...(value.validator ? [eventRef(value.validator), agentRef(value.turnId)] : []),
    ]))
    : schedulingTurns.length > 0 && schedulingTurns.every(({ action, plan, validator }) =>
      action?.metadata.status === "completed"
      && action.metadata.outcomeTypes.split(",").some((type) =>
        type === "slots_found"
        || type === "appointment_created"
        || type === "appointment_confirmed")
      && plan && plan.metadata.allowedScheduleFactCount > 0
      && validator?.metadata.valid === true)
      ? check("scheduling_correctness", "pass", schedulingTurns.flatMap((value) => [
        eventRef(value.understanding),
        eventRef(value.action!),
        eventRef(value.plan!),
        eventRef(value.validator!),
        agentRef(value.turnId),
      ]))
      : check("scheduling_correctness", "not_measurable", []);

  const effectTurns = input.run.turns.flatMap((turn) => {
    const action = event(turn.turnId, "v2.action_result");
    if (event(turn.turnId, "response.fallback_applied")) return [];
    if (!action || action.metadata.completedEffectCount + action.metadata.failedEffectCount === 0) {
      return [];
    }
    return [{ turnId: turn.turnId, action, validator: event(turn.turnId, "response.validated") }];
  });
  const inversionFailures = effectTurns.filter(({ validator }) => validator
    && parseViolations(validator).has("incompatible_speech_act"));
  const inversion = inversionFailures.length > 0
    ? check("outcome_inversion", "fail", inversionFailures.flatMap(({ turnId, action, validator }) =>
      [eventRef(action), eventRef(validator!), agentRef(turnId)]))
    : effectTurns.length > 0 && effectTurns.every(({ validator }) => validator?.metadata.valid === true)
      ? check("outcome_inversion", "pass", effectTurns.flatMap(({ turnId, action, validator }) =>
        [eventRef(action), eventRef(validator!), agentRef(turnId)]))
      : check("outcome_inversion", "not_measurable", []);

  const commitmentFailures = invalidWith(new Set(["unsupported_guarantee"]));
  const inventedCommitment = commitmentFailures.length > 0
    ? check("invented_commitment", "fail", refsForValidators(commitmentFailures))
    : check("invented_commitment", "not_measurable", []);

  const journeyTurns = input.run.turns.flatMap((turn) => {
    const decision = event(turn.turnId, "v2.decision");
    const action = event(turn.turnId, "v2.action_result");
    const outbox = event(turn.turnId, "v2.outbox");
    const validator = event(turn.turnId, "response.validated");
    return decision && action && outbox
      && decision.metadata.executeCount > 0
      && decision.metadata.intendedEffects.split(",").some((value) => value !== "none")
      && action.metadata.completedEffectCount > 0
      && action.metadata.failedEffectCount === 0
      && action.metadata.status === "completed"
      && validator?.metadata.valid === true
      && outbox.metadata.status === "enqueued"
      && outbox.metadata.messageWasNew
      && outbox.metadata.jobWasNew
      ? [{ decision, action, validator, outbox }]
      : [];
  });
  const journey = journeyTurns.length > 0
    ? check("journey_advancement", "pass", journeyTurns.flatMap(
      ({ decision, action, validator, outbox }) => [
        eventRef(decision), eventRef(action), eventRef(validator), eventRef(outbox),
      ],
    ))
    : check("journey_advancement", "not_measurable", []);

  const requiredStages = [
    "engine.selected",
    "v2.understanding",
    "v2.decision",
    "v2.action_result",
    "response.plan_built",
    "response.validated",
    "v2.outbox",
    "delivery.sent",
  ] as const;
  const criticalEvidence: string[] = [];
  let criticalComplete = true;
  let criticalFailed = false;
  for (const turn of input.run.turns) {
    const failure = event(turn.turnId, "turn.failed");
    const fallback = event(turn.turnId, "response.fallback_applied");
    if (fallback) {
      criticalComplete = false;
      criticalEvidence.push(eventRef(fallback));
    }
    if (failure) {
      criticalFailed = true;
      criticalEvidence.push(eventRef(failure));
    }
    for (const stage of requiredStages) {
      const value = event(turn.turnId, stage);
      if (!value) criticalComplete = false;
      else criticalEvidence.push(eventRef(value));
    }
    const engine = event(turn.turnId, "engine.selected");
    const outbox = event(turn.turnId, "v2.outbox");
    const delivery = event(turn.turnId, "delivery.sent");
    const validator = event(turn.turnId, "response.validated");
    const understanding = event(turn.turnId, "v2.understanding");
    const decision = event(turn.turnId, "v2.decision");
    const action = event(turn.turnId, "v2.action_result");
    if (
      engine && engine.metadata.reason !== "internal_lab_authorized"
      || understanding && understanding.metadata.status !== "completed"
      || decision && decision.metadata.status !== "prepared"
      || action && action.metadata.status !== "completed"
      || outbox && outbox.metadata.status !== "enqueued"
      || outbox && (!outbox.metadata.messageWasNew || !outbox.metadata.jobWasNew)
      || delivery && delivery.metadata.status !== "captured"
      || validator && !fallback && !validator.metadata.valid
    ) criticalFailed = true;
  }
  const critical = criticalFailed
    ? check("critical_regression", "fail", criticalEvidence)
    : criticalComplete
      ? check("critical_regression", "pass", criticalEvidence)
      : check("critical_regression", "not_measurable", []);
  const safety = criticalFailed
    ? check("safety", "fail", criticalEvidence)
    : criticalComplete
      ? check("safety", "pass", criticalEvidence)
      : check("safety", "not_measurable", []);

  const checks = Object.freeze([
    factual,
    unauthorized,
    priceBinding,
    scheduling,
    inversion,
    check("escalation", "not_measurable", []),
    inventedCommitment,
    check("relevance", "not_measurable", []),
    journey,
    critical,
    safety,
  ]);
  const expectedOrder = [...SYSTEMOPS_LAB_PERSONA_EXPECTATIONS];
  if (checks.some((value, index) => value.id !== expectedOrder[index])) {
    throw new Error("SystemOps Lab evaluation check order drifted from the closed contract");
  }
  const allEvidence = new Set([
    ...input.trace.map((value) => traceEvidenceRef(value, input.turnRefs)),
    ...input.messages.map((value) => messageEvidenceRef(value, input.turnRefs)),
  ]);
  for (const value of checks) {
    if (value.evidence.some((reference) => !allEvidence.has(reference))) {
      throw new Error("SystemOps Lab evaluation contains an unverifiable evidence reference");
    }
  }
  const automatedStatus = checks.some(({ status }) => status === "fail")
    ? "fail"
    : checks.every(({ status }) => status === "pass")
      ? "pass"
      : "not_measurable";

  return Object.freeze({
    schemaVersion: 1 as const,
    runId: input.run.runId,
    personaId: input.run.personaId,
    automatedStatus,
    checks,
    humanReview: "pending" as const,
    ownerReview: "pending" as const,
  });
}

function renderTrace(input: ReturnType<typeof canonicalizeInput>): string {
  const events = input.trace.map((event) => Object.freeze({
    evidenceRef: traceEvidenceRef(event, input.turnRefs),
    turn: input.turnRefs.get(event.turnId)!,
    sequence: event.sequence,
    stage: event.stage,
    occurredAt: event.occurredAt,
    metadata: event.metadata,
  }));
  const finalTexts = input.run.turns.map((turn, index) => {
    const agent = input.messages[(index * 2) + 1]!;
    return Object.freeze({
      turn: input.turnRefs.get(turn.turnId)!,
      evidenceRef: messageEvidenceRef(agent, input.turnRefs),
      value: agent.text,
    });
  });
  return `${JSON.stringify({
    schemaVersion: 1,
    runId: input.run.runId,
    personaId: input.run.personaId,
    events,
    finalTexts,
  }, null, 2)}\n`;
}

function renderTranscript(
  input: ReturnType<typeof canonicalizeInput>,
  evaluation: SystemOpsLabEvaluation,
): string {
  const scenario = scenarios[input.run.personaId as keyof typeof scenarios];
  const turns = input.run.turns.map((turn, index) => {
    const lead = input.messages[index * 2]!;
    const agent = input.messages[(index * 2) + 1]!;
    return [
      `## Turn ${index + 1}`,
      "",
      `LEAD (${messageEvidenceRef(lead, input.turnRefs)}): ${JSON.stringify(lead.text)}`,
      "",
      `V2 (${messageEvidenceRef(agent, input.turnRefs)}): ${JSON.stringify(agent.text)}`,
    ].join("\n");
  }).join("\n\n");
  const checks = evaluation.checks.map((value) =>
    `- ${value.id}: ${value.status.toUpperCase()}${
      value.evidence.length > 0 ? ` — ${value.evidence.join(", ")}` : ""
    }`).join("\n");

  return [
    "# SystemOps Lab Evidence",
    "",
    `Run: ${input.run.runId}`,
    `Persona: ${input.run.personaId}`,
    `Scenario: ${scenario}`,
    "",
    turns,
    "",
    "## Automated Evaluation",
    "",
    `Status: ${evaluation.automatedStatus.toUpperCase()}`,
    "",
    checks,
    "",
    "HUMAN REVIEW: PENDING",
    "OWNER REVIEW: PENDING",
    "",
    "## Owner actions",
    "",
    "- APROVAR: registrar a revisão qualitativa do owner separadamente; isto não altera o Cycle I nem substitui os reviewers formais.",
    "- RUIM: registrar o turno e o motivo qualitativo, mantendo os artifacts originais imutáveis.",
    "- CRIAR REGRESSÃO: sanitizar o caso, obter a autorização exigida e adicioná-lo ao corpus/regression test existente.",
    "",
  ].join("\n");
}

function renderLatestSummary(evaluation: SystemOpsLabEvaluation, scenario: string): string {
  return [
    "# SystemOps Lab — Latest Evidence",
    "",
    `- Run: ${evaluation.runId}`,
    `- Persona: ${evaluation.personaId}`,
    `- Scenario: ${scenario}`,
    `- Automated status: ${evaluation.automatedStatus.toUpperCase()}`,
    `- Transcript: [open](./${evaluation.runId}/transcript.md)`,
    "- Human review: PENDING",
    "- Owner review: PENDING",
    "",
  ].join("\n");
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertRegularDirectoryOrAbsent(target: string): Promise<void> {
  try {
    const stat = await lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("SystemOps Lab evidence output root must be a regular directory");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function writeSystemOpsLabEvidence(input: Readonly<{
  outputRoot: "evals/systemops-lab";
  run: SystemOpsLabRunResult;
  messages: readonly SanitizedTranscriptMessage[];
  trace: readonly SanitizedLabTraceEvent[];
}>): Promise<SystemOpsLabEvaluation> {
  if (input.outputRoot !== "evals/systemops-lab") {
    throw new Error("SystemOps Lab evidence output root is fixed");
  }
  const canonical = canonicalizeInput(input);
  const evaluation = evaluate(canonical);
  const evaluationText = `${JSON.stringify(evaluation, null, 2)}\n`;
  const traceText = renderTrace(canonical);
  const transcriptText = renderTranscript(canonical, evaluation);
  const scenario = scenarios[canonical.run.personaId as keyof typeof scenarios];
  const summaryText = renderLatestSummary(evaluation, scenario);
  for (const artifact of [evaluationText, traceText, transcriptText, summaryText]) {
    assertSafeArtifactText(artifact);
  }

  const outputRoot = path.resolve(process.cwd(), input.outputRoot);
  const finalRunDirectory = path.join(outputRoot, canonical.run.runId);
  const latestSummary = path.join(outputRoot, "latest-summary.md");
  await assertRegularDirectoryOrAbsent(path.dirname(outputRoot));
  await assertRegularDirectoryOrAbsent(outputRoot);
  if (await exists(finalRunDirectory)) {
    throw new Error("SystemOps Lab evidence run already exists; overwrite refused");
  }
  if (await exists(latestSummary)) {
    const summaryStat = await lstat(latestSummary);
    if (!summaryStat.isFile() || summaryStat.isSymbolicLink()) {
      throw new Error("SystemOps Lab latest summary must be a regular file");
    }
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const temporaryRunDirectory = path.join(
    outputRoot,
    `.${canonical.run.runId}.tmp-${process.pid}-${randomUUID()}`,
  );
  const temporarySummary = path.join(
    outputRoot,
    `.latest-summary.tmp-${process.pid}-${randomUUID()}`,
  );
  let publishedRun = false;
  try {
    await mkdir(temporaryRunDirectory, { mode: 0o700 });
    await Promise.all([
      writeFile(path.join(temporaryRunDirectory, "evaluation.json"), evaluationText, { mode: 0o600 }),
      writeFile(path.join(temporaryRunDirectory, "trace.json"), traceText, { mode: 0o600 }),
      writeFile(path.join(temporaryRunDirectory, "transcript.md"), transcriptText, { mode: 0o600 }),
      writeFile(temporarySummary, summaryText, { mode: 0o600 }),
    ]);
    await rename(temporaryRunDirectory, finalRunDirectory);
    publishedRun = true;
    await rename(temporarySummary, latestSummary);
    return evaluation;
  } catch (error) {
    if (publishedRun) await rm(finalRunDirectory, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST"
      || (error as NodeJS.ErrnoException).code === "ENOTEMPTY") {
      throw new Error("SystemOps Lab evidence run already exists; overwrite refused");
    }
    throw error;
  } finally {
    await Promise.all([
      rm(temporaryRunDirectory, { recursive: true, force: true }),
      rm(temporarySummary, { force: true }),
    ]);
  }
}
