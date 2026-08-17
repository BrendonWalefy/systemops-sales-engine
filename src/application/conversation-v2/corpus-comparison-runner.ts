import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { isProxy } from "node:util/types";
import { z } from "zod";
import { loadCorpus } from "@/application/corpus/corpus-index";
import type { CorpusCase } from "@/application/corpus/corpus-case";
import { loadCycleFAcceptanceManifest } from "@/application/corpus/cycle-f-acceptance";
import { expectedV1Intent } from "@/application/corpus/v1-understanding-adapter";
import {
  createCycleIProtocol,
  validateProtocolObservations,
  type CycleIProtocol,
  type ProtocolObservation,
} from "@/application/conversation-v2/comparison-protocol";
import type {
  ApprovedEvalRecord,
  HmacRef,
  ModelCallSummary,
} from "@/application/conversation-v2/comparison-record";
import {
  buildCycleIGateReport,
  type CycleIGateReport,
} from "@/application/conversation-v2/gate-report";
import { loadAuthorizedCycleIDecisionFixtureManifest } from "@/application/conversation-v2/decision-fixture-manifest";
import { V2ShadowRunner } from "@/application/conversation-v2/v2-shadow-runner";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalOutcomeType,
} from "@/domain-packs/dental";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";
import {
  isRegisteredAuthorizedCycleIRunManifest,
  type AuthorizedCycleIRunManifest,
} from "@/application/conversation-v2/run-manifest-authority";
import { isRegisteredProductiveCycleIArms } from "@/application/conversation-v2/productive-understanding-arms";
import { loadAuthorizedCycleIProseRecords, isRegisteredApprovedFullTurnEvidence, type ApprovedFullTurnEvidence } from "@/application/conversation-v2/approved-cycle-i-artifacts";
import { isRegisteredHumanReviewScore, type HumanReviewScore } from "@/application/conversation-v2/human-review";
import { verifyConfiguredCycleIMeasurementRunAuthority, type Ed25519SignatureRef } from "@/application/conversation-v2/configured-cycle-i-authority";

export const CYCLE_I_COMPARISON_RUN_VERSION =
  "conversation-v2-cycle-i-run.v1" as const;

export type CycleIUnderstandingArm = Readonly<{
  runCase(input: Readonly<{
    caseId: string;
    leadMessage: string;
    history: readonly Readonly<{
      author: "lead" | "agent" | "operator";
      body: string;
    }>[];
    fixedNow: string;
    hasPendingSlotOffer: boolean;
  }>): Promise<Readonly<{
    request: string | null;
    model: ModelCallSummary | null;
  }>>;
}>;

type Observation = ProtocolObservation & Readonly<{
  inputDigest: HmacRef;
  expectedRequest: string | null;
  producedRequest: string | null;
  correct: boolean | null;
  model: ModelCallSummary | null;
  errorCode: "arm_infrastructure_error" | "structured_state_unavailable" | null;
}>;

type StratumAnalysis = Readonly<{
  caseCount: number;
  observationCount: number;
  v1Correct: number;
  v2Correct: number;
  criticalRegressionCount: number;
}>;

export type CycleIComparisonRun = Readonly<{
  version: typeof CYCLE_I_COMPARISON_RUN_VERSION;
  status: "complete" | "infrastructure_error";
  runDigest: HmacRef;
  authoritySignature: Ed25519SignatureRef | null;
  binding: Readonly<{
    implementationCommit: string;
    implementationTreeDigest: HmacRef;
    runManifestDigest: HmacRef;
    configDigest: HmacRef;
    v1ModelId: string;
    v2ModelId: string;
    v1PromptDigest: HmacRef;
    v2PromptDigest: HmacRef;
    v1AdapterId: "intent-classifier.v1";
    v2AdapterId: "dental-understanding-provider.v1";
    comparabilityDigest: HmacRef;
    tenantConfigDigest: HmacRef;
  }> | null;
  protocol: CycleIProtocol;
  protocolIntegrity: Readonly<{
    status: "complete" | "infrastructure_error";
    completedObservations: number;
  }>;
  observations: readonly Observation[];
  analysis: Readonly<{
    stablePrimary: StratumAnalysis;
    d0Sensitivity: StratumAnalysis;
  }>;
  decision: Readonly<{
    approvedEvalRecords: readonly ApprovedEvalRecord[];
  }> & (
    | Readonly<{
        status: "not_measurable";
        reasons: readonly string[];
      }>
    | Readonly<{
        status: "measured";
        caseCount: number;
        matches: number;
        criticalRegressionCount: number;
        evidenceDigest: HmacRef;
      }>
  );
  prose: Readonly<{ approvedEvalRecords: readonly ApprovedEvalRecord[] }> & (
    | Readonly<{ status: "not_measurable" }>
    | Readonly<{ status: "ready" }>
  );
}>;

const modelSchema = z.object({
  modelId: z.string().min(1).max(128),
  calls: z.number().int().min(0),
  inputTokens: z.number().int().min(0).nullable(),
  outputTokens: z.number().int().min(0).nullable(),
  latencyMs: z.number().int().min(0),
  estimatedCostMinor: z.number().int().min(0).nullable(),
}).strict();
const armResultSchema = z.object({
  request: z.string().min(1).nullable(),
  model: modelSchema.nullable(),
}).strict();
const hmacSchema = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const signatureSchema = z.string().regex(/^ed25519:[a-f0-9]{128}$/);
const dentalRequestSchema = z.enum(DENTAL_REQUESTS);
const runNumberSchema = z.union([
  z.literal(1), z.literal(2), z.literal(3),
  z.literal(4), z.literal(5), z.literal(6),
]);
const caseIdSchema = z.string().regex(/^[a-z][a-z0-9-]*-\d{4}$/);
const stratumSchema = z.enum(["stable_primary", "d0_sensitivity"]);
const protocolSchema = z.object({
  runs: z.literal(6),
  corpusDigest: hmacSchema,
  d0Digest: hmacSchema,
  populationDigest: hmacSchema,
  cases: z.array(z.object({
    caseId: caseIdSchema,
    stratum: stratumSchema,
    critical: z.boolean(),
  }).strict()),
  order: z.array(z.object({
    run: runNumberSchema,
    caseId: caseIdSchema,
    arm: z.enum(["v1", "v2"]),
  }).strict()),
}).strict();
const observationSchema = z.object({
  run: runNumberSchema,
  caseId: caseIdSchema,
  arm: z.enum(["v1", "v2"]),
  stratum: stratumSchema,
  status: z.enum(["observed", "infrastructure_error", "not_measurable"]),
  payloadDigest: hmacSchema,
  corpusDigest: hmacSchema,
  d0Digest: hmacSchema,
  populationDigest: hmacSchema,
  inputDigest: hmacSchema,
  expectedRequest: z.string().nullable(),
  producedRequest: z.string().nullable(),
  correct: z.boolean().nullable(),
  model: modelSchema.nullable(),
  errorCode: z.enum([
    "arm_infrastructure_error",
    "structured_state_unavailable",
  ]).nullable(),
}).strict();
const analysisSchema = z.object({
  caseCount: z.number().int().min(0),
  observationCount: z.number().int().min(0),
  v1Correct: z.number().int().min(0),
  v2Correct: z.number().int().min(0),
  criticalRegressionCount: z.number().int().min(0),
}).strict();
const comparisonRunSchema = z.object({
  version: z.literal(CYCLE_I_COMPARISON_RUN_VERSION),
  status: z.enum(["complete", "infrastructure_error"]),
  runDigest: hmacSchema,
  authoritySignature: signatureSchema.nullable(),
  binding: z.object({
    implementationCommit: z.string().regex(/^[a-f0-9]{7,64}$/),
    implementationTreeDigest: hmacSchema, runManifestDigest: hmacSchema,
    configDigest: hmacSchema, v1ModelId: z.string().min(1), v2ModelId: z.string().min(1),
    v1PromptDigest: hmacSchema, v2PromptDigest: hmacSchema,
    v1AdapterId: z.literal("intent-classifier.v1"),
    v2AdapterId: z.literal("dental-understanding-provider.v1"),
    comparabilityDigest: hmacSchema, tenantConfigDigest: hmacSchema,
  }).strict().nullable(),
  protocol: protocolSchema,
  protocolIntegrity: z.object({
    status: z.enum(["complete", "infrastructure_error"]),
    completedObservations: z.number().int().min(0),
  }).strict(),
  observations: z.array(observationSchema),
  analysis: z.object({
    stablePrimary: analysisSchema,
    d0Sensitivity: analysisSchema,
  }).strict(),
  decision: z.union([
    z.object({
      status: z.literal("not_measurable"),
      reasons: z.array(z.string().min(1)),
      approvedEvalRecords: z.tuple([]),
    }).strict(),
    z.object({
      status: z.literal("measured"),
      caseCount: z.number().int().positive(),
      matches: z.number().int().min(0),
      criticalRegressionCount: z.number().int().min(0),
      evidenceDigest: hmacSchema,
      approvedEvalRecords: z.tuple([]),
    }).strict().refine(
      (value) => value.matches <= value.caseCount
        && value.criticalRegressionCount <= value.caseCount,
      "invalid measured Decision denominator",
    ),
  ]),
  prose: z.union([
    z.object({ status: z.literal("not_measurable"), approvedEvalRecords: z.tuple([]) }).strict(),
    z.object({ status: z.literal("ready"), approvedEvalRecords: z.array(z.unknown()).length(180) }).strict(),
  ]),
}).strict();

const WRITE_EXPECTATIONS = new Set([
  "appointment_created",
  "appointment_confirmed",
  "appointment_confirmation_accepted",
  "appointment_create_failed",
  "appointment_confirmation_failed",
  "scheduling_failed",
]);
const parsedRuns = new WeakSet<object>();
const productiveRuns = new WeakSet<object>();
const comparabilitySchema = z.object({
  version: z.literal("conversation-v2-understanding-comparability.v1"),
  cases: z.array(z.discriminatedUnion("status", [
    z.object({
      caseId: caseIdSchema,
      status: z.literal("comparable"),
      hasPendingSlotOffer: z.boolean(),
    }).strict(),
    z.object({
      caseId: caseIdSchema,
      status: z.literal("not_comparable"),
      reason: z.literal("structured_pending_state_absent"),
    }).strict(),
  ])),
}).strict();

const RECEIPT_OUTCOMES_BY_EFFECT = {
  book_slot: new Set<DentalOutcomeType>([
    "appointment_created",
    "appointment_create_failed",
  ]),
  confirm_appointment: new Set<DentalOutcomeType>([
    "appointment_confirmed",
    "appointment_confirmation_failed",
  ]),
} as const;

function freeze<T>(value: T): T {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return Object.freeze(value);
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function digest(value: unknown, domain: string): HmacRef {
  return `hmac:${createHmac("sha256", domain)
    .update(JSON.stringify(canonicalJson(value)))
    .digest("hex")}`;
}

function assertFixedClocks(
  clocks: Readonly<Record<string, string>>,
  caseIds: readonly string[],
): void {
  const keys = Object.keys(clocks).sort();
  const expected = [...caseIds].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error("fixedClockByCase must contain exactly the frozen Cycle I population");
  }
  for (const caseId of expected) {
    const value = clocks[caseId];
    if (!value || Number.isNaN(Date.parse(value))) {
      throw new Error(`invalid fixed clock for ${caseId}`);
    }
  }
}

function snapshotPlainClocks(input: unknown): Readonly<Record<string, string>> {
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) throw new Error("fixed clocks must be a plain data record without proxies");
  const snapshot: Record<string, string> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") throw new Error("fixed clocks must use string keys");
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("fixed clocks must not contain accessors");
    }
    if (typeof descriptor.value !== "string") {
      throw new Error("fixed clocks must contain string values");
    }
    snapshot[key] = descriptor.value;
  }
  return freeze(snapshot);
}

function analyze(
  protocol: CycleIProtocol,
  observations: readonly Observation[],
  stratum: "stable_primary" | "d0_sensitivity",
): StratumAnalysis {
  const cases = protocol.cases.filter((entry) => entry.stratum === stratum);
  const ids = new Set(cases.map((entry) => entry.caseId));
  const selected = observations.filter(
    (entry) => ids.has(entry.caseId) && entry.status === "observed",
  );
  let criticalRegressionCount = 0;
  for (let index = 0; index < selected.length; index += 2) {
    const v1 = selected[index];
    const v2 = selected[index + 1];
    const critical = cases.find((entry) => entry.caseId === v1?.caseId)?.critical === true;
    if (critical && v1?.correct === true && v2?.correct === false) {
      criticalRegressionCount += 1;
    }
  }
  return freeze({
    caseCount: cases.length,
    observationCount: selected.length,
    v1Correct: selected.filter((entry) => entry.arm === "v1" && entry.correct === true).length,
    v2Correct: selected.filter((entry) => entry.arm === "v2" && entry.correct === true).length,
    criticalRegressionCount,
  });
}

async function decisionEvidence(
  path: string | null,
  cases: readonly (CorpusCase & Readonly<{ critical: boolean }>)[],
  authority: AuthorizedCycleIRunManifest | null,
): Promise<CycleIComparisonRun["decision"]> {
  const reasons: string[] = [];
  if (authority === null) {
    reasons.push("productive_decision_authority_absent");
  } else if (path === null) {
    reasons.push("decision_fixture_manifest_absent");
  } else {
    try {
      const decisionManifest = loadAuthorizedCycleIDecisionFixtureManifest({
        path,
        authority,
        expectedCaseIds: cases.map((entry) => entry.caseId),
      });
      const fixtures = decisionManifest.fixtures;
      if (fixtures.length === 0) reasons.push("decision_fixture_manifest_empty");
      const byCase = new Map(cases.map((corpusCase) => [corpusCase.caseId, corpusCase]));
      let matches = 0;
      let criticalRegressionCount = 0;
      const evaluated: Array<Readonly<{
        caseId: string;
        expected: string;
        actual: string | null;
        snapshotDigest: HmacRef;
          receiptDigest: HmacRef | null;
      }>> = [];
      for (const fixture of fixtures) {
        const corpusCase = byCase.get(fixture.caseId);
        if (!corpusCase) {
          reasons.push(`fixture_outside_frozen_population:${fixture.caseId}`);
          continue;
        }
        if (
          fixture.reads.leadMessage !== corpusCase.input.leadMessage
          || JSON.stringify(fixture.reads.history) !== JSON.stringify(
            corpusCase.input.history.map((entry) => ({
              author: entry.author === "lead" ? "lead" : "agent",
              body: entry.body,
            })),
          )
        ) {
          reasons.push(`fixture_turn_mismatch:${fixture.caseId}`);
          continue;
        }
        const expected = corpusCase.labels.expectedActionResult.type;
        if (!(expected in DENTAL_OUTCOME_SCHEMA)) {
          reasons.push(`noncanonical_expected_outcome:${fixture.caseId}`);
          continue;
        }
        if (WRITE_EXPECTATIONS.has(expected) && fixture.executionReceipt === null) {
          reasons.push(`missing_execution_receipt:${fixture.caseId}`);
          continue;
        }
        const label = corpusCase.labels.understanding;
        const request = dentalRequestSchema.parse(label.request);
        const understanding: Understanding<typeof request> = {
          version: UNDERSTANDING_VERSION,
          request,
          dialogueMove: label.dialogueMove,
          entities: label.entities,
          signals: label.signals,
          safety: label.safety,
          confidence: 1,
          ambiguity: label.ambiguity,
        };
        const shadow = await new V2ShadowRunner({
          understand: async () => understanding,
          hmacKey: "cycle-i-approved-decision-fixture.v1",
          style: {
            tone: "neutral",
            verbosity: "concise",
            greeting: "omit",
            emoji: "none",
          },
        }).run(fixture.reads);
        let actual: DentalOutcomeType | null = null;
        if (shadow.status === "evaluated" && shadow.actionResults.length === 1) {
          actual = shadow.actionResults[0]!.type;
        } else if (
          shadow.status === "simulation_not_executed"
          && shadow.intendedEffects.length === 1
          && fixture.executionReceipt !== null
        ) {
          const effect = shadow.intendedEffects[0]!;
          if (
            effect.action !== fixture.executionReceipt.effect.action
            || effect.payloadHash !== fixture.executionReceipt.effect.payloadHash
            || !RECEIPT_OUTCOMES_BY_EFFECT[effect.action].has(fixture.executionReceipt.outcomeType)
          ) {
            reasons.push(`receipt_outcome_mismatch:${fixture.caseId}`);
            continue;
          }
          actual = fixture.executionReceipt.outcomeType;
        } else {
          reasons.push(`decision_pipeline_unmeasurable:${fixture.caseId}`);
          continue;
        }
        const matched = actual === expected;
        matches += Number(matched);
        criticalRegressionCount += Number(corpusCase.critical && !matched);
        evaluated.push(freeze({
          caseId: fixture.caseId,
          expected,
          actual,
          snapshotDigest: fixture.snapshotDigest,
          receiptDigest: fixture.executionReceipt?.receiptDigest ?? null,
        }));
      }
      if (reasons.length === 0 && evaluated.length > 0) {
        return freeze({
          status: "measured" as const,
          caseCount: evaluated.length,
          matches,
          criticalRegressionCount,
          evidenceDigest: digest(evaluated, "cycle-i-decision-evidence.v1"),
          approvedEvalRecords: freeze([]) as readonly ApprovedEvalRecord[],
        });
      }
    } catch {
      reasons.push("invalid_decision_fixture_manifest");
    }
  }
  return freeze({
    status: "not_measurable" as const,
    reasons: freeze(reasons.sort()),
    approvedEvalRecords: freeze([]) as readonly ApprovedEvalRecord[],
  });
}

export async function runCycleICorpusComparison(input: Readonly<{
  corpusRoot: string;
  manifestPath: string;
  d0Path: string;
  decisionFixtureManifestPath: string | null;
  v1Understanding: CycleIUnderstandingArm;
  v2Understanding: CycleIUnderstandingArm;
  runs: 6;
  fixedClockByCase: Readonly<Record<string, string>>;
  comparabilityPath?: string;
  authority?: AuthorizedCycleIRunManifest;
}>): Promise<CycleIComparisonRun> {
  if (input.runs !== 6) throw new Error("Cycle I requires exactly N = 6 runs");
  const fixedClocks = snapshotPlainClocks(input.fixedClockByCase);
  const corpus = loadCorpus(input.corpusRoot);
  const manifest = loadCycleFAcceptanceManifest(input.manifestPath, input.corpusRoot);
  const d0Raw = JSON.parse(readFileSync(input.d0Path, "utf8")) as unknown;
  const corpusDigest = digest(corpus.cases, "cycle-i-corpus.v1");
  const d0Digest = digest(d0Raw, "cycle-i-d0.v1");
  const populationDigest = digest(manifest, "cycle-i-population.v1");
  const protocol = createCycleIProtocol({
    manifest,
    d0: d0Raw,
    corpusDigest,
    d0Digest,
    populationDigest,
    runs: input.runs,
  });
  const productive = input.authority !== undefined
    && isRegisteredAuthorizedCycleIRunManifest(input.authority)
    && isRegisteredProductiveCycleIArms(
      input.v1Understanding,
      input.v2Understanding,
      input.authority,
    );
  if (input.authority !== undefined && !productive) {
    throw new Error("Cycle I productive run requires registered real Understanding arms");
  }
  if (productive) {
    const authority = input.authority!;
    if (
      authority.corpusRoot !== input.corpusRoot
      || authority.manifestPath !== input.manifestPath
      || authority.d0Path !== input.d0Path
      || authority.comparabilityPath !== (input.comparabilityPath ?? "evals/cycle-i/understanding-comparability.json")
      || authority.corpusDigest !== corpusDigest
      || authority.populationDigest !== populationDigest
      || authority.d0Digest !== d0Digest
    ) throw new Error("Cycle I productive run content does not match its authorized manifest");
  }
  assertFixedClocks(fixedClocks, protocol.cases.map((entry) => entry.caseId));
  const byId = new Map(corpus.cases.map((entry) => [entry.caseId, entry]));
  const strata = new Map(protocol.cases.map((entry) => [entry.caseId, entry.stratum]));
  const comparability = comparabilitySchema.parse(JSON.parse(readFileSync(
    input.comparabilityPath ?? "evals/cycle-i/understanding-comparability.json", "utf8",
  )));
  const comparabilityDigest = digest(comparability, "cycle-i-comparability.v1");
  if (productive && input.authority!.comparabilityDigest !== comparabilityDigest) {
    throw new Error("Cycle I comparability content does not match its authorized manifest");
  }
  const comparableById = new Map(comparability.cases.map((entry) => [entry.caseId, entry]));
  if (
    comparability.cases.length !== protocol.cases.length
    || new Set(comparability.cases.map((entry) => entry.caseId)).size !== protocol.cases.length
    || protocol.cases.some((entry) => !comparableById.has(entry.caseId))
  ) throw new Error("comparability fixture must cover the exact frozen population");
  const turnInputs = new Map(protocol.cases.map(({ caseId }) => {
    const corpusCase = byId.get(caseId);
    const comparison = comparableById.get(caseId);
    if (!corpusCase) throw new Error(`missing frozen corpus case: ${caseId}`);
    return [caseId, freeze({
      caseId,
      leadMessage: corpusCase.input.leadMessage,
      history: corpusCase.input.history.map((entry) => freeze({
        author: entry.author,
        body: entry.body,
      })),
      fixedNow: fixedClocks[caseId]!,
      hasPendingSlotOffer: comparison?.status === "comparable"
        ? comparison.hasPendingSlotOffer
        : false,
    })] as const;
  }));
  const observations: Observation[] = [];

  for (const scheduled of protocol.order) {
    const corpusCase = byId.get(scheduled.caseId);
    if (!corpusCase) throw new Error(`missing frozen corpus case: ${scheduled.caseId}`);
    const turnInput = turnInputs.get(corpusCase.caseId)!;
    const expectedRequest = scheduled.arm === "v1"
      ? expectedV1Intent(corpusCase.labels.understanding.request)
      : corpusCase.labels.understanding.request;
    const common = {
      ...scheduled,
      stratum: strata.get(scheduled.caseId)!,
      inputDigest: digest(turnInput, "cycle-i-turn-input.v1"),
      corpusDigest,
      d0Digest,
      populationDigest,
      expectedRequest,
    };
    const caseComparability = comparableById.get(scheduled.caseId)!;
    if (caseComparability.status === "not_comparable") {
      observations.push(freeze({
        ...common,
        status: "not_measurable" as const,
        producedRequest: null,
        correct: null,
        model: null,
        errorCode: "structured_state_unavailable" as const,
        payloadDigest: digest({
          arm: scheduled.arm,
          status: "not_measurable",
          reason: caseComparability.reason,
        }, "cycle-i-observation.v1"),
      }));
      continue;
    }
    try {
      const arm = scheduled.arm === "v1" ? input.v1Understanding : input.v2Understanding;
      const produced = armResultSchema.parse(await arm.runCase(turnInput));
      if (productive) {
        const expectedModel = scheduled.arm === "v1"
          ? input.authority!.v1.modelId
          : input.authority!.v2.modelId;
        if (produced.model?.modelId !== expectedModel) {
          throw new Error("productive arm returned a model outside its authorized manifest");
        }
      }
      const observation = freeze({
        ...common,
        status: "observed" as const,
        producedRequest: produced.request,
        correct: expectedRequest === null ? null : produced.request === expectedRequest,
        model: produced.model,
        errorCode: null,
        payloadDigest: digest({
          arm: scheduled.arm,
          expectedRequest,
          producedRequest: produced.request,
          model: produced.model,
        }, "cycle-i-observation.v1"),
      });
      observations.push(observation);
    } catch {
      observations.push(freeze({
        ...common,
        status: "infrastructure_error" as const,
        producedRequest: null,
        correct: null,
        model: null,
        errorCode: "arm_infrastructure_error" as const,
        payloadDigest: digest({
          arm: scheduled.arm,
          status: "infrastructure_error",
        }, "cycle-i-observation.v1"),
      }));
    }
  }

  const completedObservations = observations.filter(
    (entry) => entry.status !== "infrastructure_error",
  ).length;
  const status = observations.some((entry) => entry.status === "infrastructure_error")
    ? "infrastructure_error" as const
    : "complete" as const;
  if (status === "complete") {
    validateProtocolObservations(protocol, observations.map((entry) => ({
      run: entry.run,
      caseId: entry.caseId,
      arm: entry.arm,
      stratum: entry.stratum,
      status: entry.status,
      payloadDigest: entry.payloadDigest,
      corpusDigest: entry.corpusDigest,
      d0Digest: entry.d0Digest,
      populationDigest: entry.populationDigest,
    })));
  }
  const analysis = freeze({
    stablePrimary: analyze(protocol, observations, "stable_primary"),
    d0Sensitivity: analyze(protocol, observations, "d0_sensitivity"),
  });
  const decision = await decisionEvidence(
    input.decisionFixtureManifestPath,
    protocol.cases.map((entry) => ({ ...byId.get(entry.caseId)!, critical: entry.critical })),
    productive ? input.authority! : null,
  );
  const proseRecords = productive ? loadAuthorizedCycleIProseRecords({
    authority: input.authority!,
    expectedCaseIds: comparability.cases
      .filter((entry) => entry.status === "comparable")
      .map((entry) => entry.caseId),
  }) : freeze([]) as readonly ApprovedEvalRecord[];
  const prose = proseRecords.length === 0
    ? freeze({ status: "not_measurable" as const, approvedEvalRecords: freeze([]) as readonly ApprovedEvalRecord[] })
    : freeze({ status: "ready" as const, approvedEvalRecords: proseRecords });
  const withoutDigest = {
    version: CYCLE_I_COMPARISON_RUN_VERSION,
    status,
    binding: productive ? freeze({
      implementationCommit: input.authority!.implementationCommit,
      implementationTreeDigest: input.authority!.implementationTreeDigest,
      runManifestDigest: input.authority!.manifestDigest,
      configDigest: input.authority!.configDigest,
      v1ModelId: input.authority!.v1.modelId,
      v2ModelId: input.authority!.v2.modelId,
      v1PromptDigest: input.authority!.v1.promptDigest,
      v2PromptDigest: input.authority!.v2.promptDigest,
      v1AdapterId: input.authority!.v1.adapterId,
      v2AdapterId: input.authority!.v2.adapterId,
      comparabilityDigest: input.authority!.comparabilityDigest,
      tenantConfigDigest: input.authority!.tenantConfigDigest,
    }) : null,
    protocol,
    protocolIntegrity: freeze({ status, completedObservations }),
    observations: freeze(observations),
    analysis,
    decision,
    prose,
  };
  const candidate = freeze({
    version: withoutDigest.version,
    status: withoutDigest.status,
    authoritySignature: null,
    binding: withoutDigest.binding,
    runDigest: digest(withoutDigest, "cycle-i-comparison-run.v1"),
    protocol: withoutDigest.protocol,
    protocolIntegrity: withoutDigest.protocolIntegrity,
    observations: withoutDigest.observations,
    analysis: withoutDigest.analysis,
    decision: withoutDigest.decision,
    prose: withoutDigest.prose,
  });
  const parsed = parseCycleIComparisonRun(JSON.parse(JSON.stringify(candidate)));
  if (productive) productiveRuns.add(parsed);
  return parsed;
}

export function parseCycleIComparisonRun(input: unknown): CycleIComparisonRun {
  const parsed = comparisonRunSchema.parse(input);
  if (parsed.protocol.cases.length !== 17 || parsed.protocol.order.length !== 204) {
    throw new Error("Cycle I comparison run has an invalid frozen denominator");
  }
  if (parsed.observations.length !== 204) {
    throw new Error("Cycle I comparison run dropped a scheduled observation");
  }
  if (parsed.binding) {
    for (const observation of parsed.observations) {
      if (observation.status !== "observed") continue;
      const expectedModel = observation.arm === "v1"
        ? parsed.binding.v1ModelId
        : parsed.binding.v2ModelId;
      if (observation.model?.modelId !== expectedModel) {
        throw new Error("Cycle I comparison model does not match the bound manifest");
      }
    }
  }
  for (let index = 0; index < parsed.protocol.order.length; index += 1) {
    const scheduled = parsed.protocol.order[index]!;
    const observation = parsed.observations[index]!;
    if (
      scheduled.run !== observation.run
      || scheduled.caseId !== observation.caseId
      || scheduled.arm !== observation.arm
    ) throw new Error(`Cycle I comparison order integrity failure at ${index}`);
    if (index % 2 === 0 && scheduled.arm !== "v1") {
      throw new Error(`Cycle I comparison pair does not start with V1 at ${index}`);
    }
    if (index % 2 === 1) {
      const previous = parsed.observations[index - 1]!;
      if (
        scheduled.arm !== "v2"
        || previous.caseId !== observation.caseId
        || previous.run !== observation.run
        || previous.inputDigest !== observation.inputDigest
      ) throw new Error(`Cycle I comparison pair integrity failure at ${index}`);
    }
  }
  const completedObservations = parsed.observations.filter(
    (entry) => entry.status !== "infrastructure_error",
  ).length;
  const expectedStatus = parsed.observations.some(
    (entry) => entry.status === "infrastructure_error",
  ) ? "infrastructure_error" : "complete";
  if (
    parsed.status !== expectedStatus
    || parsed.protocolIntegrity.status !== expectedStatus
    || parsed.protocolIntegrity.completedObservations !== completedObservations
  ) throw new Error("Cycle I comparison status does not match observations");
  const protocol = parsed.protocol as CycleIProtocol;
  const observations = parsed.observations as readonly Observation[];
  const rederivedAnalysis = {
    stablePrimary: analyze(protocol, observations, "stable_primary"),
    d0Sensitivity: analyze(protocol, observations, "d0_sensitivity"),
  };
  if (JSON.stringify(parsed.analysis) !== JSON.stringify(rederivedAnalysis)) {
    throw new Error("Cycle I comparison analysis integrity failure");
  }
  if (expectedStatus === "complete") {
    validateProtocolObservations(protocol, observations.map((entry) => ({
      run: entry.run,
      caseId: entry.caseId,
      arm: entry.arm,
      stratum: entry.stratum,
      status: entry.status,
      payloadDigest: entry.payloadDigest,
      corpusDigest: entry.corpusDigest,
      d0Digest: entry.d0Digest,
      populationDigest: entry.populationDigest,
    })));
  }
  const unsignedContent = Object.fromEntries(Object.entries(parsed).filter(
    ([key]) => key !== "runDigest" && key !== "authoritySignature",
  ));
  if (digest(unsignedContent, "cycle-i-comparison-run.v1") !== parsed.runDigest) {
    throw new Error("Cycle I comparison run digest integrity failure");
  }
  const registered = freeze(parsed) as CycleIComparisonRun;
  parsedRuns.add(registered);
  return registered;
}

export function parseProductiveCycleIComparisonRun(
  input: unknown,
  authority: AuthorizedCycleIRunManifest,
): CycleIComparisonRun {
  if (!isRegisteredAuthorizedCycleIRunManifest(authority)) {
    throw new Error("Cycle I run manifest is not registered by its authority parser");
  }
  const run = parseCycleIComparisonRun(input);
  if (run.authoritySignature === null || !verifyConfiguredCycleIMeasurementRunAuthority(
    serializeCycleIComparisonRunAuthorityPayload(run),
    run.authoritySignature,
  )) throw new Error("Cycle I serialized productive run authority signature is invalid or absent");
  const binding = run.binding;
  if (
    binding === null
    || binding.implementationCommit !== authority.implementationCommit
    || binding.implementationTreeDigest !== authority.implementationTreeDigest
    || binding.runManifestDigest !== authority.manifestDigest
    || binding.configDigest !== authority.configDigest
    || binding.v1ModelId !== authority.v1.modelId
    || binding.v2ModelId !== authority.v2.modelId
    || binding.v1PromptDigest !== authority.v1.promptDigest
    || binding.v2PromptDigest !== authority.v2.promptDigest
    || binding.v1AdapterId !== authority.v1.adapterId
    || binding.v2AdapterId !== authority.v2.adapterId
    || binding.comparabilityDigest !== authority.comparabilityDigest
    || binding.tenantConfigDigest !== authority.tenantConfigDigest
    || run.protocol.corpusDigest !== authority.corpusDigest
    || run.protocol.populationDigest !== authority.populationDigest
    || run.protocol.d0Digest !== authority.d0Digest
  ) throw new Error("Cycle I productive run does not match its authorized manifest");
  productiveRuns.add(run);
  return run;
}

export function serializeCycleIComparisonRunAuthorityPayload(run: CycleIComparisonRun): string {
  const material = { ...run, authoritySignature: null };
  return JSON.stringify(canonicalJson(material));
}

export function isRegisteredProductiveCycleIRun(run: CycleIComparisonRun): boolean {
  return parsedRuns.has(run) && productiveRuns.has(run);
}

type GateEvidenceInput = Readonly<{
  reportDigest: HmacRef;
  populationDigest: HmacRef;
  datasetDigest: HmacRef;
  configDigest: HmacRef;
  run: CycleIComparisonRun;
  evidence: Readonly<Partial<{
    hEntailment: HmacRef;
    shadowNoEffects: HmacRef;
    cycleFAxes: HmacRef;
    rollback: HmacRef;
    observability: HmacRef;
  }>>;
  humanReview: HumanReviewScore | null;
  approvedFullTurnReplay: ApprovedFullTurnEvidence | null;
  verification: HmacRef | null;
  adversarialReview: HmacRef | null;
}>;

export function buildCycleIGateEvidence(input: GateEvidenceInput): CycleIGateReport {
  if (!parsedRuns.has(input.run) || !productiveRuns.has(input.run)) {
    throw new Error("Cycle I gate evidence requires a registered productive run");
  }
  if (
    input.run.protocol.populationDigest !== input.populationDigest
    || input.run.protocol.corpusDigest !== input.datasetDigest
    || input.run.binding?.configDigest !== input.configDigest
  ) throw new Error("Cycle I gate context does not match the registered productive run");
  if (input.humanReview !== null && !isRegisteredHumanReviewScore(input.humanReview)) {
    throw new Error("Cycle I qualitative evidence requires a registered calibrated human review");
  }
  if (input.approvedFullTurnReplay !== null && !isRegisteredApprovedFullTurnEvidence(input.approvedFullTurnReplay)) {
    throw new Error("Cycle I full-turn evidence requires an approved replay/Lab parser result");
  }
  const context = {
    populationDigest: input.populationDigest,
    datasetDigest: input.datasetDigest,
    configDigest: input.configDigest,
  };
  const measured = (evidenceDigest: HmacRef, denominator: number) => ({
    evidenceDigest,
    ...context,
    denominator,
  });
  const complete = input.run.status === "complete";
  const measurements: Record<string, unknown> = {};
  if (input.evidence.hEntailment) {
    measurements.h_entailment = { ...measured(input.evidence.hEntailment, 1), passed: true };
  }
  if (input.evidence.shadowNoEffects) {
    measurements.shadow_no_effects = {
      ...measured(input.evidence.shadowNoEffects, 1),
      sideEffects: 0,
      contamination: 0,
    };
  }
  if (complete) {
    measurements.protocol_integrity = {
      ...measured(input.run.runDigest, 204),
      completedObservations: input.run.protocolIntegrity.completedObservations,
    };
    const primary = input.run.analysis.stablePrimary;
    const sensitivity = input.run.analysis.d0Sensitivity;
    if (input.evidence.cycleFAxes) {
      measurements.supported_understanding = {
        ...measured(input.evidence.cycleFAxes, 90),
        v1Correct: primary.v1Correct + sensitivity.v1Correct,
        v2Correct: primary.v2Correct + sensitivity.v2Correct,
        cycleFAxesPassed: true,
        criticalRegressionCount:
          primary.criticalRegressionCount + sensitivity.criticalRegressionCount,
      };
    }
    if (input.run.decision.status === "measured") {
      measurements.supported_decision = {
        ...measured(input.run.decision.evidenceDigest, 1),
        matches: Number(
          input.run.decision.matches === input.run.decision.caseCount
          && input.run.decision.criticalRegressionCount === 0,
        ),
      };
    }
    measurements.critical_regressions = {
      ...measured(input.run.runDigest, 180),
      count:
        primary.criticalRegressionCount
        + sensitivity.criticalRegressionCount
        + (input.run.decision.status === "measured"
          ? input.run.decision.criticalRegressionCount
          : 0),
    };
  }
  if (complete && input.run.prose.status === "ready" && input.humanReview === null) {
    measurements.qualitative = {
      completed: false,
      factuallyCorrect: { v1: 0, v2: 0 },
      addressedWhatTheLeadRaised: { v1: 0, v2: 0 },
      advancedTheJourney: { v1: 0, v2: 0 },
      wouldRepeatToday: { v1: 0, v2: 0 },
      criticalFactuallyIncorrectCount: 0,
    };
  }
  if (complete && input.run.prose.status === "ready" && input.humanReview !== null) {
    const dimensions = input.humanReview.dimensions;
    const criticalIds = new Set(input.run.protocol.cases.filter((entry) => entry.critical).map((entry) => entry.caseId));
    measurements.qualitative = {
      ...measured(digest(input.humanReview, "cycle-i-human-review-evidence.v1"), 1),
      completed: true,
      factuallyCorrect: { v1: dimensions.factuallyCorrect.v1, v2: dimensions.factuallyCorrect.v2 },
      addressedWhatTheLeadRaised: { v1: dimensions.addressedWhatTheLeadRaised.v1, v2: dimensions.addressedWhatTheLeadRaised.v2 },
      advancedTheJourney: { v1: dimensions.advancedTheJourney.v1, v2: dimensions.advancedTheJourney.v2 },
      wouldRepeatToday: { v1: dimensions.wouldRepeatToday.v1, v2: dimensions.wouldRepeatToday.v2 },
      criticalFactuallyIncorrectCount: input.humanReview.reviewers.reduce((count, reviewer) => count + reviewer.pairs.filter((pair) => criticalIds.has(pair.caseId) && !pair.v2.factuallyCorrect).length, 0),
    };
  }
  if (input.approvedFullTurnReplay !== null) {
    measurements.full_turn_cost = { ...measured(input.approvedFullTurnReplay.evidenceDigest as HmacRef, 1), v1MeanMinor: input.approvedFullTurnReplay.v1MeanMinor, v2MeanMinor: input.approvedFullTurnReplay.v2MeanMinor };
    measurements.full_turn_p95 = { ...measured(input.approvedFullTurnReplay.evidenceDigest as HmacRef, 1), v1P95Ms: input.approvedFullTurnReplay.v1P95Ms, v2P95Ms: input.approvedFullTurnReplay.v2P95Ms };
  }
  if (input.evidence.rollback) {
    measurements.rollback = { ...measured(input.evidence.rollback, 1), passed: true };
  }
  if (input.evidence.observability) {
    measurements.observability = { ...measured(input.evidence.observability, 1), passed: true };
  }
  if (input.verification) {
    measurements.verification = { ...measured(input.verification, 1), passed: true };
  }
  if (input.adversarialReview) {
    measurements.adversarial_review = {
      ...measured(input.adversarialReview, 1),
      passed: true,
    };
  }
  return buildCycleIGateReport({
    reportDigest: input.reportDigest,
    ...context,
    measurements,
  });
}
