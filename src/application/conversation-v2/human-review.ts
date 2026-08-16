import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApprovedEvalPair, HmacRef } from "@/application/conversation-v2/comparison-record";

export type HumanReviewRating = Readonly<{ factuallyCorrect: boolean; addressedWhatTheLeadRaised: boolean; advancedTheJourney: boolean; wouldRepeatToday: boolean }>;
export type HumanReviewSheet = Readonly<{ version: "conversation-v2-human-review.v1"; runDigest: HmacRef; entries: readonly Readonly<{ run: 1 | 2 | 3 | 4 | 5 | 6; caseId: string; responses: readonly Readonly<{ position: 1 | 2; outputText: string }>[] }>[] }>;
export type HumanReviewScore = Readonly<{ reviewers: readonly Readonly<{ reviewer: "A" | "B"; pairs: readonly Readonly<{ run: number; caseId: string; v1: HumanReviewRating; v2: HumanReviewRating }>[] }>[]; dimensions: Readonly<Record<keyof HumanReviewRating, Readonly<{ v1: number; v2: number; ties: number; disagreements: number }>>> }>;

const hmacRef = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const caseId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]{4}$/);
const ratingSchema = z.object({ factuallyCorrect: z.boolean(), addressedWhatTheLeadRaised: z.boolean(), advancedTheJourney: z.boolean(), wouldRepeatToday: z.boolean() }).strict();
const reviewerSchema = z.object({ pairs: z.array(z.object({ run: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), caseId, ratings: z.tuple([ratingSchema, ratingSchema]) }).strict()) }).strict();
const mappings = new WeakMap<object, Map<string, readonly ["v1" | "v2", "v1" | "v2"]>>();
const dimensions = ["factuallyCorrect", "addressedWhatTheLeadRaised", "advancedTheJourney", "wouldRepeatToday"] as const;
function freeze<T>(value: T): T { if (Array.isArray(value)) value.forEach(freeze); else if (value !== null && typeof value === "object") Object.values(value as Record<string, unknown>).forEach(freeze); return Object.freeze(value); }

function assertPair(pair: ApprovedEvalPair): void {
  if (pair.v1.arm !== "v1" || pair.v2.arm !== "v2") throw new Error("human review pair must contain V1 and V2");
  if (pair.v1.snapshotDigest !== pair.v2.snapshotDigest || pair.snapshotDigest !== pair.v1.snapshotDigest) throw new Error(`human review snapshot mismatch: ${pair.caseId}`);
  if (pair.v1.run !== pair.run || pair.v2.run !== pair.run || pair.v1.caseId !== pair.caseId || pair.v2.caseId !== pair.caseId) throw new Error(`human review pair identity mismatch: ${pair.caseId}`);
}

export function buildBlindHumanReviewSheet(input: { runDigest: string; pairs: readonly ApprovedEvalPair[] }): HumanReviewSheet {
  const digest = hmacRef.parse(input.runDigest) as HmacRef;
  const entries: HumanReviewSheet["entries"][number][] = [];
  const map = new Map<string, readonly ["v1" | "v2", "v1" | "v2"]>();
  const keys = new Set<string>();
  for (const pair of input.pairs) {
    assertPair(pair);
    const key = `${pair.run}:${pair.caseId}`;
    if (keys.has(key)) throw new Error(`duplicate human review pair: ${key}`);
    keys.add(key);
    const v1First = createHash("sha256").update(`${digest}:${pair.pairDigest}:${key}`).digest()[0]! % 2 === 0;
    const arms: readonly ["v1" | "v2", "v1" | "v2"] = v1First ? ["v1", "v2"] : ["v2", "v1"];
    const byArm = { v1: pair.v1.outputText, v2: pair.v2.outputText };
    entries.push(freeze({ run: pair.run, caseId: pair.caseId, responses: [freeze({ position: 1 as const, outputText: byArm[arms[0]] }), freeze({ position: 2 as const, outputText: byArm[arms[1]] })] }));
    map.set(key, arms);
  }
  const sheet = freeze({ version: "conversation-v2-human-review.v1" as const, runDigest: digest, entries: entries.sort((a, b) => a.run - b.run || a.caseId.localeCompare(b.caseId)) });
  mappings.set(sheet, map);
  return sheet;
}

function parseReviewer(input: unknown, sheet: HumanReviewSheet, mappingsForSheet: Map<string, readonly ["v1" | "v2", "v1" | "v2"]>): readonly Readonly<{ run: number; caseId: string; v1: HumanReviewRating; v2: HumanReviewRating }>[] {
  const reviewer = reviewerSchema.parse(input);
  if (reviewer.pairs.length !== sheet.entries.length) throw new Error("missing human review rating");
  const expected = new Set(sheet.entries.map((item) => `${item.run}:${item.caseId}`));
  const seen = new Set<string>();
  const result: Array<Readonly<{ run: number; caseId: string; v1: HumanReviewRating; v2: HumanReviewRating }>> = [];
  for (const entry of reviewer.pairs) {
    const key = `${entry.run}:${entry.caseId}`;
    if (!expected.has(key)) throw new Error(`unexpected human review rating: ${key}`);
    if (seen.has(key)) throw new Error(`duplicate human review rating: ${key}`);
    seen.add(key);
    const arms = mappingsForSheet.get(key);
    if (!arms) throw new Error(`missing blind mapping: ${key}`);
    const byArm = { [arms[0]]: entry.ratings[0], [arms[1]]: entry.ratings[1] } as { v1: HumanReviewRating; v2: HumanReviewRating };
    result.push(freeze({ run: entry.run, caseId: entry.caseId, v1: byArm.v1, v2: byArm.v2 }));
  }
  for (const key of expected) if (!seen.has(key)) throw new Error(`missing human review rating: ${key}`);
  return freeze(result.sort((a, b) => a.run - b.run || a.caseId.localeCompare(b.caseId)));
}

export function scoreHumanReview(input: { sheet: HumanReviewSheet; reviewerA: unknown; reviewerB: unknown }): HumanReviewScore {
  const mapping = mappings.get(input.sheet);
  if (!mapping || !Object.isFrozen(input.sheet)) throw new Error("human review sheet is not an issued immutable sheet");
  const a = parseReviewer(input.reviewerA, input.sheet, mapping);
  const b = parseReviewer(input.reviewerB, input.sheet, mapping);
  const score: Record<keyof HumanReviewRating, { v1: number; v2: number; ties: number; disagreements: number }> = { factuallyCorrect: { v1: 0, v2: 0, ties: 0, disagreements: 0 }, addressedWhatTheLeadRaised: { v1: 0, v2: 0, ties: 0, disagreements: 0 }, advancedTheJourney: { v1: 0, v2: 0, ties: 0, disagreements: 0 }, wouldRepeatToday: { v1: 0, v2: 0, ties: 0, disagreements: 0 } };
  for (let index = 0; index < a.length; index += 1) for (const dimension of dimensions) {
    const first = a[index]!, second = b[index]!;
    if (first.v1[dimension]) score[dimension].v1 += 1;
    if (first.v2[dimension]) score[dimension].v2 += 1;
    if (second.v1[dimension]) score[dimension].v1 += 1;
    if (second.v2[dimension]) score[dimension].v2 += 1;
    if (first.v1[dimension] === first.v2[dimension]) score[dimension].ties += 1;
    if (second.v1[dimension] === second.v2[dimension]) score[dimension].ties += 1;
    if (first.v1[dimension] !== second.v1[dimension] || first.v2[dimension] !== second.v2[dimension]) score[dimension].disagreements += 1;
  }
  return freeze({ reviewers: [freeze({ reviewer: "A" as const, pairs: a }), freeze({ reviewer: "B" as const, pairs: b })], dimensions: score });
}
