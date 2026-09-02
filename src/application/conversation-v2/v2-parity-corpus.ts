import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { PROACTIVE_AUTHORIZATION_KINDS } from "@/application/automation/proactive-outbound";
import { DECISION_TRACE_STAGES } from "@/core/observability/DecisionTrace";
import { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental/capabilities";
import { DENTAL_OUTCOME_PROVENANCE } from "@/domain-packs/dental/outcome-provenance";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";

export const V2_CAPABILITY_PARITY_CORPUS_VERSION =
  "v2-capability-parity.v1" as const;

const terminalTraceStages = new Set<string>([
  "delivery.sent",
  "turn.ignored",
  "turn.failed",
]);
const dentalCapabilityIds = new Set<string>(
  DENTAL_OUTCOME_PROVENANCE.map(({ capabilityId }) => capabilityId),
);
const dentalOutcomeTypes = new Set<string>(Object.keys(DENTAL_OUTCOME_SCHEMA));
const evidencePathPattern = /^src\/__tests__\/[A-Za-z0-9./-]+\.test\.ts$/;
const obviousPii = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /(?:\+?\d[\s().-]*){8,}/,
] as const;

const commonScenario = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  example: z.string().trim().min(3).max(240),
  expectedOutcomes: z.array(
    z.string().refine((value) => dentalOutcomeTypes.has(value), "unknown dental outcome"),
  ),
  requiredTraceStages: z.array(z.enum(DECISION_TRACE_STAGES)).min(1),
  evidenceTests: z.array(z.string().regex(evidencePathPattern)).min(1),
}).strict();

const inboundScenario = commonScenario.extend({
  kind: z.literal("inbound"),
  request: z.enum(DENTAL_REQUESTS),
  capabilityId: z.string().refine(
    (value) => dentalCapabilityIds.has(value),
    "unknown dental capability",
  ),
  expectedOutcomes: commonScenario.shape.expectedOutcomes.min(1),
}).strict();

const proactiveScenario = commonScenario.extend({
  kind: z.literal("proactive"),
  authorizationKind: z.enum(PROACTIVE_AUTHORIZATION_KINDS),
  category: z.enum(PROACTIVE_AUTHORIZATION_KINDS),
  capabilityId: z.literal("v2-proactive-automation"),
  expectedOutcomes: commonScenario.shape.expectedOutcomes.length(0),
}).strict();

const corpusSchema = z.object({
  version: z.literal(V2_CAPABILITY_PARITY_CORPUS_VERSION),
  scenarios: z.array(z.discriminatedUnion("kind", [inboundScenario, proactiveScenario])).min(1),
}).strict();

export type V2CapabilityParityCorpusV1 = Readonly<z.infer<typeof corpusSchema>>;

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
  } else if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return Object.freeze(value);
}

function exactCoverage(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000");
}

export function parseV2CapabilityParityCorpus(
  value: unknown,
  options: Readonly<{ repositoryRoot?: string }> = {},
): V2CapabilityParityCorpusV1 {
  const parsed = corpusSchema.parse(value);
  const ids = parsed.scenarios.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("V2 parity corpus contains duplicate scenario IDs");
  }

  const inboundRequests = parsed.scenarios
    .filter((scenario) => scenario.kind === "inbound")
    .map(({ request }) => request);
  if (!exactCoverage(inboundRequests, DENTAL_REQUESTS)) {
    throw new Error("V2 parity corpus must exactly cover every dental request once");
  }

  const proactiveKinds = parsed.scenarios
    .filter((scenario) => scenario.kind === "proactive")
    .map(({ authorizationKind }) => authorizationKind);
  if (!exactCoverage(proactiveKinds, PROACTIVE_AUTHORIZATION_KINDS)) {
    throw new Error("V2 parity corpus must exactly cover every proactive kind once");
  }

  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  for (const scenario of parsed.scenarios) {
    if (obviousPii.some((detector) => detector.test(scenario.example))) {
      throw new Error(`V2 parity scenario ${scenario.id} retained obvious PII`);
    }
    if (!scenario.requiredTraceStages.some((stage) => terminalTraceStages.has(stage))) {
      throw new Error(`V2 parity scenario ${scenario.id} has no terminal trace stage`);
    }
    if (scenario.kind === "proactive" && scenario.category !== scenario.authorizationKind) {
      throw new Error(`V2 proactive scenario ${scenario.id} category does not match authorization`);
    }
    for (const evidencePath of scenario.evidenceTests) {
      if (!existsSync(resolve(repositoryRoot, evidencePath))) {
        throw new Error(`V2 parity scenario ${scenario.id} references missing evidence test`);
      }
    }
  }

  return deepFreeze(parsed) as V2CapabilityParityCorpusV1;
}

export function loadV2CapabilityParityCorpus(
  path: string,
  options: Readonly<{ repositoryRoot?: string }> = {},
): V2CapabilityParityCorpusV1 {
  return parseV2CapabilityParityCorpus(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
    options,
  );
}
