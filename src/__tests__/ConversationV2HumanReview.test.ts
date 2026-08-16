import { describe, expect, it } from "vitest";
import { buildBlindHumanReviewSheet, scoreHumanReview } from "@/application/conversation-v2/human-review";
import type { ApprovedEvalPair } from "@/application/conversation-v2/comparison-record";

const ref = `hmac:${"a".repeat(64)}` as const;
const pair: ApprovedEvalPair = { run: 1, caseId: "price-0001", pairDigest: ref, snapshotDigest: ref, v1: { version: "conversation-v2-approved-eval.v1", run: 1, caseId: "price-0001", arm: "v1", snapshotDigest: ref, outputText: "V1", source: { kind: "committed_corpus", corpusDigest: ref } }, v2: { version: "conversation-v2-approved-eval.v1", run: 1, caseId: "price-0001", arm: "v2", snapshotDigest: ref, outputText: "V2", source: { kind: "committed_corpus", corpusDigest: ref } } };
const rating = (reviewerRef: string) => ({ reviewerRef, calibrationDigest: ref, pairs: [{ run: 1, caseId: "price-0001", ratings: [{ factuallyCorrect: true, addressedWhatTheLeadRaised: true, advancedTheJourney: true, wouldRepeatToday: true }, { factuallyCorrect: true, addressedWhatTheLeadRaised: true, advancedTheJourney: true, wouldRepeatToday: true }] }] });

describe("Cycle I human review", () => {
  it("uses deterministic blind ordering and requires two complete reviewers", () => {
    const sheet = buildBlindHumanReviewSheet({ runDigest: ref, pairs: [pair] });
    expect(sheet.entries[0]!.responses).toHaveLength(2);
    expect(buildBlindHumanReviewSheet({ runDigest: ref, pairs: [pair] })).toEqual(sheet);
    expect(() => scoreHumanReview({ sheet, pairs: [pair], runDigest: ref, reviewerA: rating(ref), reviewerB: { reviewerRef: `hmac:${"b".repeat(64)}`, calibrationDigest: ref, pairs: [] } })).toThrow(/missing/i);
  });

  it("retains reviewer-level scores, ties, and disagreements", () => {
    const sheet = buildBlindHumanReviewSheet({ runDigest: ref, pairs: [pair] });
    const score = scoreHumanReview({ sheet: JSON.parse(JSON.stringify(sheet)), pairs: [pair], runDigest: ref, reviewerA: rating(ref), reviewerB: rating(`hmac:${"b".repeat(64)}`) });
    expect(score.reviewers).toHaveLength(2);
    expect(score.dimensions.factuallyCorrect.v1).toBe(score.dimensions.factuallyCorrect.v2);
    expect(() => scoreHumanReview({ sheet, pairs: [pair], runDigest: ref, reviewerA: rating(ref), reviewerB: rating(ref) })).toThrow(/distinct/i);
    expect(() => scoreHumanReview({ sheet, pairs: [pair], runDigest: ref, reviewerA: { ...rating(ref), pairs: [{ ...rating(ref).pairs[0], ratings: [{ factuallyCorrect: true }, {}] }] }, reviewerB: rating(`hmac:${"b".repeat(64)}`) })).toThrow();
  });
});
