import { describe, expect, it } from "vitest";
import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";

const plan: V2AuthorizedResponsePlan = {
  version: "authorized-response-plan.v2",
  subjects: [
    { ref: "subject-a", type: "item", id: "a" },
    { ref: "subject-option", type: "window", id: "w1" },
  ],
  evidence: [{ ref: "evidence-0", source: "read", reference: "snapshot" }],
  facts: [
    { ref: "fact-a", key: "amount", value: 1200, subjectRef: "subject-a", evidenceRef: "evidence-0", disclosure: "allowed" },
    { ref: "fact-internal", key: "score", value: 0.8, subjectRef: null, evidenceRef: "evidence-0", disclosure: "internal" },
    { ref: "fact-option", key: "window_label", value: "15:00", subjectRef: "subject-option", evidenceRef: "evidence-0", disclosure: "allowed" },
  ],
  options: [{ ref: "option-0", id: "w1", subjectRef: "subject-option", factRefs: ["fact-option"] }],
  outcomes: [
    { ref: "info", outcomeType: "opaque-info", semanticClass: "information_authorized", origin: { capabilityId: "one" }, subjectRef: "subject-a", evidenceRefs: ["evidence-0"], factRefs: ["fact-a", "fact-internal"], optionRefs: [] },
    { ref: "options", outcomeType: "opaque-options", semanticClass: "options_found", origin: { capabilityId: "two" }, subjectRef: null, evidenceRefs: ["evidence-0"], factRefs: [], optionRefs: ["option-0"] },
    { ref: "completed", outcomeType: "opaque-completed", semanticClass: "effect_completed", origin: { capabilityId: "three" }, subjectRef: "subject-a", evidenceRefs: ["evidence-0"], factRefs: ["fact-a"], optionRefs: [] },
    { ref: "failed", outcomeType: "opaque-failed", semanticClass: "effect_failed", origin: { capabilityId: "four" }, subjectRef: null, evidenceRefs: [], factRefs: [], optionRefs: [] },
    { ref: "human", outcomeType: "opaque-human", semanticClass: "human_action_required", origin: { capabilityId: "five" }, subjectRef: null, evidenceRefs: [], factRefs: [], optionRefs: [] },
    { ref: "clarify", outcomeType: "opaque-clarify", semanticClass: "clarification_required", origin: { capabilityId: "six" }, subjectRef: null, evidenceRefs: [], factRefs: [], optionRefs: [] },
  ],
};

describe("composer determinístico V2", () => {
  it("organiza cada outcome no único speech act compatível e preserva a ordem", async () => {
    const composer = new DeterministicResponseComposer();

    await expect(composer.compose({
      plan,
      style: { tone: "warm", verbosity: "standard", greeting: "include", emoji: "light" },
    })).resolves.toEqual({
      acts: [
        { kind: "inform_fact", outcomeRef: "info", factRef: "fact-a", subjectRef: "subject-a" },
        { kind: "offer_options", outcomeRef: "options", subjectRef: null, optionRefs: ["option-0"] },
        { kind: "confirm_effect", outcomeRef: "completed", subjectRef: "subject-a", factRefs: ["fact-a"] },
        { kind: "communicate_failure", outcomeRef: "failed" },
        { kind: "inform_required_action", outcomeRef: "human" },
        { kind: "ask_clarification", outcomeRef: "clarify" },
      ],
    });
  });

  it("não transforma fact interno em speech act", async () => {
    const composer = new DeterministicResponseComposer();
    const draft = await composer.compose({
      plan,
      style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
    });

    expect(draft.acts).not.toContainEqual(expect.objectContaining({ factRef: "fact-internal" }));
  });
});
