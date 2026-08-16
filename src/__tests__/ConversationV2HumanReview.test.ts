import { describe, expect, it } from "vitest";
import { buildBlindHumanReviewSheet, deriveBlindArmOrder, scoreHumanReview } from "@/application/conversation-v2/human-review";
import type { ApprovedEvalPair } from "@/application/conversation-v2/comparison-record";

const ref = `hmac:${"a".repeat(64)}` as const;
const pair: ApprovedEvalPair = { run: 1, caseId: "price-0001", pairDigest: ref, snapshotDigest: ref, v1: { version: "conversation-v2-approved-eval.v1", run: 1, caseId: "price-0001", arm: "v1", snapshotDigest: ref, outputText: "V1", source: { kind: "committed_corpus", corpusDigest: ref } }, v2: { version: "conversation-v2-approved-eval.v1", run: 1, caseId: "price-0001", arm: "v2", snapshotDigest: ref, outputText: "V2", source: { kind: "committed_corpus", corpusDigest: ref } } };
const rating = (reviewerRef: string) => ({ reviewerRef, calibrationDigest: ref, pairs: [{ run: 1, caseId: "price-0001", ratings: [{ factuallyCorrect: true, addressedWhatTheLeadRaised: true, advancedTheJourney: true, wouldRepeatToday: true }, { factuallyCorrect: true, addressedWhatTheLeadRaised: true, advancedTheJourney: true, wouldRepeatToday: true }] }] });
const calibration = (reviewerRefs = [ref, `hmac:${"b".repeat(64)}`]) => ({ version: "conversation-v2-reviewer-calibration.v1", rubricDigest: "93882ca73baa8c3c08576995fbf4ef4cb4babe507dcb7eabc2c88a176d3a58ed", manifestDigest: ref, reviewers: reviewerRefs.map((reviewerRef) => ({ reviewerRef, calibrationDigest: ref, evidenceDigest: ref, rates: { factuallyCorrect: 0.8, addressedWhatTheLeadRaised: 0.8, advancedTheJourney: 0.8, wouldRepeatToday: 0.8 } })) });

describe("Cycle I human review", () => {
  it("uses deterministic blind ordering and requires two complete reviewers", () => {
    const sheet = buildBlindHumanReviewSheet({ runDigest: ref, pairs: [pair] });
    expect(sheet.entries[0]!.responses).toHaveLength(2);
    expect(buildBlindHumanReviewSheet({ runDigest: ref, pairs: [pair] })).toEqual(sheet);
    expect(() => scoreHumanReview({ sheet, pairs: [pair], runDigest: ref, calibrationManifest: calibration(), reviewerA: rating(ref), reviewerB: { reviewerRef: `hmac:${"b".repeat(64)}`, calibrationDigest: ref, pairs: [] } })).toThrow(/missing/i);
  });

  it("retains reviewer-level scores, ties, and disagreements", () => {
    const sheet = buildBlindHumanReviewSheet({ runDigest: ref, pairs: [pair] });
    const score = scoreHumanReview({ sheet: JSON.parse(JSON.stringify(sheet)), pairs: [pair], runDigest: ref, calibrationManifest: calibration(), reviewerA: rating(ref), reviewerB: rating(`hmac:${"b".repeat(64)}`) });
    expect(score.reviewers).toHaveLength(2);
    expect(score.dimensions.factuallyCorrect.v1).toBe(score.dimensions.factuallyCorrect.v2);
    expect(() => scoreHumanReview({ sheet, pairs: [pair], runDigest: ref, calibrationManifest: calibration(), reviewerA: rating(ref), reviewerB: rating(ref) })).toThrow(/distinct/i);
    expect(() => scoreHumanReview({ sheet, pairs: [pair], runDigest: ref, calibrationManifest: calibration([`hmac:${"c".repeat(64)}`, `hmac:${"d".repeat(64)}`]), reviewerA: rating(ref), reviewerB: rating(`hmac:${"b".repeat(64)}`) })).toThrow(/calibr/i);
    expect(() => scoreHumanReview({ sheet, pairs: [pair], runDigest: ref, calibrationManifest: calibration(), reviewerA: { ...rating(ref), pairs: [{ ...rating(ref).pairs[0], ratings: [{ factuallyCorrect: true }, {}] }] }, reviewerB: rating(`hmac:${"b".repeat(64)}`) })).toThrow();
  });

  it("keeps a V2-first blind order even when the two texts are identical", () => {
    const runDigest = Array.from({ length: 20 }, (_, index) => `hmac:${"a".repeat(63)}${index.toString(16)}`).find((value) => deriveBlindArmOrder(value, pair.pairDigest, "1:price-0001")[0] === "v2")!;
    expect(deriveBlindArmOrder(runDigest, pair.pairDigest, "1:price-0001")).toEqual(["v2", "v1"]);
    const identical = { ...pair, v1: { ...pair.v1, outputText: "igual" }, v2: { ...pair.v2, outputText: "igual" } };
    const sheet = buildBlindHumanReviewSheet({ runDigest, pairs: [identical] });
    const asymmetric = (reviewerRef: string) => ({ reviewerRef, calibrationDigest: ref, pairs: [{ run: 1, caseId: "price-0001", ratings: [{ factuallyCorrect: true, addressedWhatTheLeadRaised: true, advancedTheJourney: true, wouldRepeatToday: true }, { factuallyCorrect: false, addressedWhatTheLeadRaised: false, advancedTheJourney: false, wouldRepeatToday: false }] }] });
    const score = scoreHumanReview({ sheet, pairs: [identical], runDigest, calibrationManifest: calibration(), reviewerA: asymmetric(ref), reviewerB: asymmetric(`hmac:${"b".repeat(64)}`) });
    expect(score.dimensions.factuallyCorrect).toMatchObject({ v1: 0, v2: 2 });
  });
});
