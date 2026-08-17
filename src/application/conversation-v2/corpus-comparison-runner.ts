import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { loadCycleIDecisionFixtureManifest } from "@/application/conversation-v2/decision-fixture-manifest";
import { V2ShadowRunner } from "@/application/conversation-v2/v2-shadow-runner";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalOutcomeType,
} from "@/domain-packs/dental";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";

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
  errorCode: "arm_infrastructure_error" | null;
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
  prose: Readonly<{
    status: "not_measurable";
    approvedEvalRecords: readonly ApprovedEvalRecord[];
  }>;
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
  status: z.enum(["observed", "infrastructure_error"]),
  payloadDigest: hmacSchema,
  corpusDigest: hmacSchema,
  d0Digest: hmacSchema,
  populationDigest: hmacSchema,
  inputDigest: hmacSchema,
  expectedRequest: z.string().nullable(),
  producedRequest: z.string().nullable(),
  correct: z.boolean().nullable(),
  model: modelSchema.nullable(),
  errorCode: z.literal("arm_infrastructure_error").nullable(),
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
  prose: z.object({
    status: z.literal("not_measurable"),
    approvedEvalRecords: z.tuple([]),
  }).strict(),
}).strict();

const WRITE_EXPECTATIONS = new Set([
  "appointment_created",
  "appointment_confirmed",
  "appointment_confirmation_accepted",
  "appointment_create_failed",
  "appointment_confirmation_failed",
  "scheduling_failed",
]);

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

function analyze(
  protocol: CycleIProtocol,
  observations: readonly Observation[],
  stratum: "stable_primary" | "d0_sensitivity",
): StratumAnalysis {
  const cases = protocol.cases.filter((entry) => entry.stratum === stratum);
  const ids = new Set(cases.map((entry) => entry.caseId));
  const selected = observations.filter((entry) => ids.has(entry.caseId));
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
): Promise<CycleIComparisonRun["decision"]> {
  const reasons: string[] = [];
  if (path === null) {
    reasons.push("decision_fixture_manifest_absent");
  } else {
    try {
      const fixtures = loadCycleIDecisionFixtureManifest(path);
      if (fixtures.length === 0) reasons.push("decision_fixture_manifest_empty");
      const byCase = new Map(cases.map((corpusCase) => [corpusCase.caseId, corpusCase]));
      let matches = 0;
      let criticalRegressionCount = 0;
      const evaluated: Array<Readonly<{
        caseId: string;
        expected: string;
        actual: string | null;
        snapshotDigest: HmacRef;
        approvalDigest: HmacRef;
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
          if (!RECEIPT_OUTCOMES_BY_EFFECT[effect.action].has(
            fixture.executionReceipt.outcomeType,
          )) {
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
          approvalDigest: fixture.approval.digest,
          receiptDigest: fixture.executionReceipt?.evidenceDigest ?? null,
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
}>): Promise<CycleIComparisonRun> {
  if (input.runs !== 6) throw new Error("Cycle I requires exactly N = 6 runs");
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
  assertFixedClocks(input.fixedClockByCase, protocol.cases.map((entry) => entry.caseId));
  const byId = new Map(corpus.cases.map((entry) => [entry.caseId, entry]));
  const strata = new Map(protocol.cases.map((entry) => [entry.caseId, entry.stratum]));
  const observations: Observation[] = [];

  for (const scheduled of protocol.order) {
    const corpusCase = byId.get(scheduled.caseId);
    if (!corpusCase) throw new Error(`missing frozen corpus case: ${scheduled.caseId}`);
    const turnInput = freeze({
      caseId: corpusCase.caseId,
      leadMessage: corpusCase.input.leadMessage,
      history: corpusCase.input.history.map((entry) => freeze({
        author: entry.author,
        body: entry.body,
      })),
      fixedNow: input.fixedClockByCase[corpusCase.caseId]!,
    });
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
    try {
      const arm = scheduled.arm === "v1" ? input.v1Understanding : input.v2Understanding;
      const produced = armResultSchema.parse(await arm.runCase(turnInput));
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

  const completedObservations = observations.filter((entry) => entry.status === "observed").length;
  const status = completedObservations === protocol.order.length
    ? "complete" as const
    : "infrastructure_error" as const;
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
  );
  const prose = freeze({
    status: "not_measurable" as const,
    approvedEvalRecords: freeze([]) as readonly ApprovedEvalRecord[],
  });
  const withoutDigest = {
    version: CYCLE_I_COMPARISON_RUN_VERSION,
    status,
    protocol,
    protocolIntegrity: freeze({ status, completedObservations }),
    observations: freeze(observations),
    analysis,
    decision,
    prose,
  };
  return freeze({
    version: withoutDigest.version,
    status: withoutDigest.status,
    runDigest: digest(withoutDigest, "cycle-i-comparison-run.v1"),
    protocol: withoutDigest.protocol,
    protocolIntegrity: withoutDigest.protocolIntegrity,
    observations: withoutDigest.observations,
    analysis: withoutDigest.analysis,
    decision: withoutDigest.decision,
    prose: withoutDigest.prose,
  });
}

export function parseCycleIComparisonRun(input: unknown): CycleIComparisonRun {
  const parsed = comparisonRunSchema.parse(input);
  if (parsed.protocol.cases.length !== 17 || parsed.protocol.order.length !== 204) {
    throw new Error("Cycle I comparison run has an invalid frozen denominator");
  }
  if (parsed.observations.length !== 204) {
    throw new Error("Cycle I comparison run dropped a scheduled observation");
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
    (entry) => entry.status === "observed",
  ).length;
  const expectedStatus = completedObservations === 204 ? "complete" : "infrastructure_error";
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
  const { runDigest, ...withoutDigest } = parsed;
  if (digest(withoutDigest, "cycle-i-comparison-run.v1") !== runDigest) {
    throw new Error("Cycle I comparison run digest integrity failure");
  }
  return freeze(parsed) as CycleIComparisonRun;
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
  humanReview: null;
  approvedFullTurnReplay: null;
  verification: HmacRef | null;
  adversarialReview: HmacRef | null;
}>;

export function buildCycleIGateEvidence(input: GateEvidenceInput): CycleIGateReport {
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
        ...measured(input.evidence.cycleFAxes, 102),
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
      ...measured(input.run.runDigest, 204),
      count:
        primary.criticalRegressionCount
        + sensitivity.criticalRegressionCount
        + (input.run.decision.status === "measured"
          ? input.run.decision.criticalRegressionCount
          : 0),
    };
  }
  if (complete) {
    measurements.qualitative = {
      completed: false,
      factuallyCorrect: { v1: 0, v2: 0 },
      addressedWhatTheLeadRaised: { v1: 0, v2: 0 },
      advancedTheJourney: { v1: 0, v2: 0 },
      wouldRepeatToday: { v1: 0, v2: 0 },
      criticalFactuallyIncorrectCount: 0,
    };
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
