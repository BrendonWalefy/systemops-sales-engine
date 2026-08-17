import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApprovedEvalPair, HmacRef } from "@/application/conversation-v2/comparison-record";

export type HumanReviewRating = Readonly<{ factuallyCorrect: boolean; addressedWhatTheLeadRaised: boolean; advancedTheJourney: boolean; wouldRepeatToday: boolean }>;
export type HumanReviewSheet = Readonly<{ version: "conversation-v2-human-review.v1"; runDigest: HmacRef; entries: readonly Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; responses: readonly Readonly<{ position: 1 | 2; outputText: string }>[] }>[] }>;
export type HumanReviewScore = Readonly<{ reviewers: readonly Readonly<{ reviewerRef: HmacRef; calibrationDigest: HmacRef; pairs: readonly Readonly<{ run: number; caseId: string; v1: HumanReviewRating; v2: HumanReviewRating }>[] }>[]; dimensions: Readonly<Record<keyof HumanReviewRating, Readonly<{ v1: number; v2: number; ties: number; disagreements: number }>>> }>;
export const APPROVED_REVIEWER_RUBRIC_DIGEST = "93882ca73baa8c3c08576995fbf4ef4cb4babe507dcb7eabc2c88a176d3a58ed" as const;
export type ApprovedReviewerCalibrationManifest = Readonly<{ version: "conversation-v2-reviewer-calibration.v1"; rubricDigest: typeof APPROVED_REVIEWER_RUBRIC_DIGEST; manifestDigest: HmacRef; reviewers: readonly Readonly<{ reviewerRef: HmacRef; calibrationDigest: HmacRef; evidenceDigest: HmacRef; rates: Readonly<Record<keyof HumanReviewRating, number>> }>[] }>;
const hmac = z.string().regex(/^hmac:[a-f0-9]{64}$/, "invalid HmacRef");
const run = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]);
const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{4}$/);
const ratingSchema = z.object({ factuallyCorrect: z.boolean(), addressedWhatTheLeadRaised: z.boolean(), advancedTheJourney: z.boolean(), wouldRepeatToday: z.boolean() }).strict();
const sheetSchema = z.object({ version: z.literal("conversation-v2-human-review.v1"), runDigest: hmac, entries: z.array(z.object({ run, caseId: id, responses: z.tuple([z.object({ position: z.literal(1), outputText: z.string() }).strict(), z.object({ position: z.literal(2), outputText: z.string() }).strict()]) }).strict()) }).strict();
const reviewerSchema = z.object({ reviewerRef: hmac, calibrationDigest: hmac, pairs: z.array(z.object({ run, caseId: id, ratings: z.tuple([ratingSchema, ratingSchema]) }).strict()) }).strict();
const calibrationSchema = z.object({ version: z.literal("conversation-v2-reviewer-calibration.v1"), rubricDigest: z.literal(APPROVED_REVIEWER_RUBRIC_DIGEST), manifestDigest: hmac, reviewers: z.array(z.object({ reviewerRef: hmac, calibrationDigest: hmac, evidenceDigest: hmac, rates: z.object({ factuallyCorrect: z.number().min(0.8).max(1), addressedWhatTheLeadRaised: z.number().min(0.8).max(1), advancedTheJourney: z.number().min(0.8).max(1), wouldRepeatToday: z.number().min(0.8).max(1) }).strict() }).strict()).min(2) }).strict();
const dimensions = ["factuallyCorrect", "addressedWhatTheLeadRaised", "advancedTheJourney", "wouldRepeatToday"] as const;
const registeredScores = new WeakSet<object>();
function freeze<T>(value: T): T { if (Array.isArray(value)) value.forEach(freeze); else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze); return Object.freeze(value); }
function key(pair: { run: number; caseId: string }) { return `${pair.run}:${pair.caseId}`; }
export function parseApprovedReviewerCalibrationManifest(input: unknown): ApprovedReviewerCalibrationManifest { const parsed = calibrationSchema.parse(input); if (new Set(parsed.reviewers.map((item) => item.reviewerRef)).size !== parsed.reviewers.length) throw new Error("duplicate calibrated reviewer"); return freeze(parsed) as ApprovedReviewerCalibrationManifest; }
export function deriveBlindArmOrder(runDigest: string, pairDigest: string, pairKey: string): readonly ["v1" | "v2", "v1" | "v2"] { hmac.parse(runDigest); hmac.parse(pairDigest); const first = createHash("sha256").update(`${runDigest}:${pairDigest}:${pairKey}`).digest()[0]! % 2 === 0 ? "v1" : "v2"; return first === "v1" ? ["v1", "v2"] : ["v2", "v1"]; }
function assertPair(pair: ApprovedEvalPair): void { if (pair.v1.arm !== "v1" || pair.v2.arm !== "v2" || pair.v1.snapshotDigest !== pair.v2.snapshotDigest || pair.snapshotDigest !== pair.v1.snapshotDigest || pair.v1.run !== pair.run || pair.v2.run !== pair.run || pair.v1.caseId !== pair.caseId || pair.v2.caseId !== pair.caseId) throw new Error(`invalid approved evaluation pair: ${pair.caseId}`); }
export function buildBlindHumanReviewSheet(input: { runDigest: string; pairs: readonly ApprovedEvalPair[] }): HumanReviewSheet {
  const runDigest = hmac.parse(input.runDigest) as HmacRef; const seen = new Set<string>();
  const entries = input.pairs.map((pair) => { assertPair(pair); const pairKey = key(pair); if (seen.has(pairKey)) throw new Error(`duplicate human review pair: ${pairKey}`); seen.add(pairKey); const [first, second] = deriveBlindArmOrder(runDigest, pair.pairDigest, pairKey); const byArm = { v1: pair.v1.outputText, v2: pair.v2.outputText }; return freeze({ run: pair.run, caseId: pair.caseId, responses: [freeze({ position: 1 as const, outputText: byArm[first] }), freeze({ position: 2 as const, outputText: byArm[second] })] }); });
  return freeze({ version: "conversation-v2-human-review.v1" as const, runDigest, entries: entries.sort((a, b) => a.run - b.run || a.caseId.localeCompare(b.caseId)) });
}
function scoreReviewer(input: unknown, expected: HumanReviewSheet, pairs: readonly ApprovedEvalPair[], calibration: ApprovedReviewerCalibrationManifest, runDigest: string) {
  const reviewer = reviewerSchema.parse(input); if (reviewer.pairs.length !== expected.entries.length) throw new Error("missing human review rating"); const pairMap = new Map(pairs.map((pair) => [key(pair), pair])); const seen = new Set<string>();
  const rows = reviewer.pairs.map((entry) => { const entryKey = key(entry); if (seen.has(entryKey)) throw new Error(`duplicate human review rating: ${entryKey}`); seen.add(entryKey); const pair = pairMap.get(entryKey); if (!pair) throw new Error(`unexpected human review rating: ${entryKey}`); if (!expected.entries.some((item) => key(item) === entryKey)) throw new Error(`missing human review pair: ${entryKey}`); const v1First = deriveBlindArmOrder(runDigest, pair.pairDigest, entryKey)[0] === "v1"; return freeze({ run: entry.run, caseId: entry.caseId, v1: entry.ratings[v1First ? 0 : 1], v2: entry.ratings[v1First ? 1 : 0] }); });
  const approved = calibration.reviewers.find((item) => item.reviewerRef === reviewer.reviewerRef && item.calibrationDigest === reviewer.calibrationDigest); if (!approved) throw new Error("reviewer is not present in approved calibration manifest");
  return freeze({ reviewerRef: reviewer.reviewerRef as HmacRef, calibrationDigest: reviewer.calibrationDigest as HmacRef, pairs: rows.sort((a, b) => a.run - b.run || a.caseId.localeCompare(b.caseId)) });
}
export function scoreHumanReview(input: { sheet: unknown; pairs: readonly ApprovedEvalPair[]; runDigest: string; calibrationManifest: unknown; reviewerA: unknown; reviewerB: unknown }): HumanReviewScore {
  const expected = buildBlindHumanReviewSheet({ runDigest: input.runDigest, pairs: input.pairs }); const received = freeze(sheetSchema.parse(input.sheet)) as HumanReviewSheet;
  if (JSON.stringify(received) !== JSON.stringify(expected)) throw new Error("serialized human review sheet does not match deterministic manifest");
  const calibration = parseApprovedReviewerCalibrationManifest(input.calibrationManifest); const a = scoreReviewer(input.reviewerA, expected, input.pairs, calibration, input.runDigest), b = scoreReviewer(input.reviewerB, expected, input.pairs, calibration, input.runDigest); if (a.reviewerRef === b.reviewerRef) throw new Error("human reviewers must be distinct");
  const score: Record<keyof HumanReviewRating, { v1: number; v2: number; ties: number; disagreements: number }> = { factuallyCorrect: { v1: 0, v2: 0, ties: 0, disagreements: 0 }, addressedWhatTheLeadRaised: { v1: 0, v2: 0, ties: 0, disagreements: 0 }, advancedTheJourney: { v1: 0, v2: 0, ties: 0, disagreements: 0 }, wouldRepeatToday: { v1: 0, v2: 0, ties: 0, disagreements: 0 } };
  for (let i = 0; i < a.pairs.length; i += 1) for (const dimension of dimensions) { const left = a.pairs[i]!, right = b.pairs[i]!; score[dimension].v1 += Number(left.v1[dimension]) + Number(right.v1[dimension]); score[dimension].v2 += Number(left.v2[dimension]) + Number(right.v2[dimension]); score[dimension].ties += Number(left.v1[dimension] === left.v2[dimension]) + Number(right.v1[dimension] === right.v2[dimension]); score[dimension].disagreements += Number(left.v1[dimension] !== right.v1[dimension] || left.v2[dimension] !== right.v2[dimension]); }
  const result = freeze({ reviewers: [a, b], dimensions: score });
  registeredScores.add(result);
  return result;
}

export function isRegisteredHumanReviewScore(input: HumanReviewScore | null): input is HumanReviewScore {
  return input !== null && registeredScores.has(input);
}
