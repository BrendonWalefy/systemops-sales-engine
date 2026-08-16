import { z } from "zod";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";

export const CYCLE_I_GATE_REPORT_VERSION = "conversation-v2-cycle-i-gate.v1" as const;
const criterionNames = ["h_entailment", "shadow_no_effects", "protocol_integrity", "supported_understanding", "supported_decision", "critical_regressions", "qualitative", "full_turn_cost", "full_turn_p95", "rollback", "observability", "verification", "adversarial_review"] as const;
type CriterionName = typeof criterionNames[number];
type CriterionStatus = "pass" | "fail" | "not_measurable" | "pending_human_review";
export type CycleIGateCriterion = Readonly<{ status: CriterionStatus; layer: string; population: string; denominator: number; applicable: true; blocking: boolean; evidenceDigest: HmacRef | null }>;
export type CycleIGateReport = Readonly<{ version: typeof CYCLE_I_GATE_REPORT_VERSION; reportDigest: HmacRef; judge: "experimental_non_gating"; criteria: Readonly<Record<CriterionName, CycleIGateCriterion>>; decision: "GO" | "NO_GO" }>;
export type CycleIGateInputs = Readonly<{ reportDigest: string; criteria?: Partial<Record<CriterionName, Readonly<{ status?: CriterionStatus; evidenceDigest?: string | null }>>> }>;

const applicability: Readonly<Record<CriterionName, Omit<CycleIGateCriterion, "status" | "evidenceDigest">>> = Object.freeze({
  h_entailment: { layer: "cycles_a_to_h", population: "h-entailment", denominator: 1, applicable: true, blocking: true }, shadow_no_effects: { layer: "shadow", population: "all-shadow-observations", denominator: 1, applicable: true, blocking: true }, protocol_integrity: { layer: "corpus", population: "cycle-f-supported-dental-corpus", denominator: 204, applicable: true, blocking: true }, supported_understanding: { layer: "understanding", population: "cycle-f-supported-dental-corpus", denominator: 102, applicable: true, blocking: true }, supported_decision: { layer: "decision", population: "approved-decision-receipts", denominator: 1, applicable: true, blocking: true }, critical_regressions: { layer: "safety", population: "stable-primary-and-d0-sensitivity", denominator: 204, applicable: true, blocking: true }, qualitative: { layer: "prose", population: "blind-human-review", denominator: 1, applicable: true, blocking: true }, full_turn_cost: { layer: "performance", population: "approved-replay-or-lab", denominator: 1, applicable: true, blocking: true }, full_turn_p95: { layer: "performance", population: "approved-replay-or-lab", denominator: 1, applicable: true, blocking: true }, rollback: { layer: "activation", population: "test-tenant-selector", denominator: 1, applicable: true, blocking: true }, observability: { layer: "observability", population: "minimum-required-fields", denominator: 1, applicable: true, blocking: true }, verification: { layer: "verification", population: "required-suite", denominator: 1, applicable: true, blocking: true }, adversarial_review: { layer: "review", population: "independent-adversarial-review", denominator: 1, applicable: true, blocking: true },
} as Record<CriterionName, Omit<CycleIGateCriterion, "status" | "evidenceDigest">>);
for (const name of criterionNames) Object.freeze(applicability[name]);
const hmacRef = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const criterionSchema = z.object({ status: z.enum(["pass", "fail", "not_measurable", "pending_human_review"]), layer: z.string(), population: z.string(), denominator: z.number().int().min(1), applicable: z.literal(true), blocking: z.boolean(), evidenceDigest: hmacRef.nullable() }).strict();
const reportSchema = z.object({ version: z.literal(CYCLE_I_GATE_REPORT_VERSION), reportDigest: hmacRef, judge: z.literal("experimental_non_gating"), criteria: z.object(Object.fromEntries(criterionNames.map((name) => [name, criterionSchema])) as Record<CriterionName, typeof criterionSchema>).strict(), decision: z.enum(["GO", "NO_GO"]) }).strict();
function freeze<T>(value: T): T { if (Array.isArray(value)) value.forEach(freeze); else if (value !== null && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze); return Object.freeze(value); }
function expectedDecision(criteria: Readonly<Record<CriterionName, CycleIGateCriterion>>): "GO" | "NO_GO" { return criterionNames.every((name) => !criteria[name].blocking || criteria[name].status === "pass") ? "GO" : "NO_GO"; }
function assertApplicability(criteria: Readonly<Record<CriterionName, CycleIGateCriterion>>): void { for (const name of criterionNames) { const fixed = applicability[name], actual = criteria[name]; if (actual.layer !== fixed.layer || actual.population !== fixed.population || actual.denominator !== fixed.denominator || actual.applicable !== fixed.applicable || actual.blocking !== fixed.blocking) throw new Error(`immutable applicability mismatch: ${name}`); } }

export function buildCycleIGateReport(input: CycleIGateInputs): CycleIGateReport {
  const criteria = {} as Record<CriterionName, CycleIGateCriterion>;
  for (const name of criterionNames) { const proposed = input.criteria?.[name]; criteria[name] = freeze({ ...applicability[name], status: proposed?.status ?? "not_measurable", evidenceDigest: proposed?.evidenceDigest === undefined ? null : hmacRef.parse(proposed.evidenceDigest) as HmacRef | null }); }
  const result = { version: CYCLE_I_GATE_REPORT_VERSION, reportDigest: hmacRef.parse(input.reportDigest) as HmacRef, judge: "experimental_non_gating" as const, criteria: freeze(criteria), decision: expectedDecision(criteria) };
  return freeze(result);
}

export function parseCycleIGateReport(input: unknown): CycleIGateReport {
  const report = reportSchema.parse(input) as CycleIGateReport;
  assertApplicability(report.criteria);
  if (report.decision !== expectedDecision(report.criteria)) throw new Error("GO decision conflicts with a blocking gate");
  return freeze(report);
}
