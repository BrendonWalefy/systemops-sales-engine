import { describe, expect, it } from "vitest";
import type { Understanding } from "@/conversation-core/understanding/schema";
import { buildDentalResponseConversationBrief } from "@/domain-packs/dental/response-conversation-brief";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

function understanding(
  overrides: Partial<Understanding<DentalRequest>> = {},
): Understanding<DentalRequest> {
  return {
    version: "understanding.v1",
    request: "price-of-service",
    dialogueMove: "answers_pending",
    entities: {
      service: "private service value",
      businessInformationTopic: null,
      date: null,
      period: null,
      time: null,
      serviceCandidates: null,
      quantity: null,
      ordinal: null,
    },
    signals: {
      purchaseIntent: "high",
      priceSensitivity: "high",
      sentiment: "negative",
      objection: "private free-form objection",
    },
    safety: { optOut: false, requestsHuman: false, emergency: false },
    confidence: 0.9,
    ambiguity: { kind: "service", candidates: ["private a", "private b"] },
    ...overrides,
  };
}

describe("bounded dental response conversation brief", () => {
  it("keeps only closed conversational signals from accepted Understanding", () => {
    const brief = buildDentalResponseConversationBrief(understanding());

    expect(brief).toEqual({
      request: "price-of-service",
      dialogueMove: "answers_pending",
      sentiment: "negative",
      purchaseIntent: "high",
      priceSensitivity: "high",
      hasObjection: true,
      ambiguityKind: "service",
    });
    expect(Object.isFrozen(brief)).toBe(true);

    const serialized = JSON.stringify(brief);
    expect(serialized).not.toContain("private service value");
    expect(serialized).not.toContain("private free-form objection");
    expect(serialized).not.toContain("private a");
    expect(serialized).not.toContain("confidence");
    expect(serialized).not.toContain("safety");
  });

  it.each([
    ["new_topic", "new_topic"],
    ["answers_pending", "answers_pending"],
    ["acknowledges", "acknowledges"],
    ["repeats", "repeats"],
    ["closes", "closes"],
  ] as const)("preserves the registered %s dialogue move", (dialogueMove, expected) => {
    expect(buildDentalResponseConversationBrief(understanding({ dialogueMove })))
      .toMatchObject({ dialogueMove: expected });
  });

  it("fails closed for unregistered runtime vocabulary", () => {
    const untrusted = understanding({
      request: "invented-request" as DentalRequest,
      dialogueMove: "invented-move" as Understanding<DentalRequest>["dialogueMove"],
      signals: {
        purchaseIntent: "urgent",
        priceSensitivity: "unknown",
        sentiment: "furious",
        objection: "still private",
      },
      ambiguity: { kind: "private-ambiguity", candidates: ["one", "two"] },
    });

    expect(buildDentalResponseConversationBrief(untrusted)).toEqual({
      request: null,
      dialogueMove: "new_topic",
      sentiment: null,
      purchaseIntent: null,
      priceSensitivity: null,
      hasObjection: true,
      ambiguityKind: null,
    });
  });

  it("does not claim an objection for null, empty or whitespace text", () => {
    for (const objection of [null, "", "   "]) {
      const brief = buildDentalResponseConversationBrief(understanding({
        signals: {
          purchaseIntent: null,
          priceSensitivity: null,
          sentiment: null,
          objection,
        },
        ambiguity: null,
      }));

      expect(brief).toMatchObject({ hasObjection: false, ambiguityKind: null });
    }
  });
});
