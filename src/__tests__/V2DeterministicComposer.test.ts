import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { defineOutcomeSchema } from "@/conversation-core/decision";
import type { ActionResult } from "@/conversation-core/decision";

const outcomeSchema = defineOutcomeSchema({
  opaque_info: { semanticClass: "information_authorized", subjectRequirement: "required", evidenceRequirement: "required" },
  opaque_options: { semanticClass: "options_found", subjectRequirement: "optional", evidenceRequirement: "required" },
  opaque_completed: { semanticClass: "effect_completed", subjectRequirement: "required", evidenceRequirement: "required" },
  opaque_failed: { semanticClass: "effect_failed", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
  opaque_human: { semanticClass: "human_action_required", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
  opaque_clarify: { semanticClass: "clarification_required", subjectRequirement: "forbidden", evidenceRequirement: "optional" },
} as const);
const subject = { type: "item", id: "a", displayName: "Item A" } as const;
const optionSubject = { type: "window", id: "w1", displayName: "15:00" } as const;
const evidence = { source: "read", reference: "snapshot" } as const;
const amount = { key: "amount", value: { kind: "integer", value: 1200 }, subject, evidence, disclosure: "allowed" } as const;
const internal = { key: "score", value: { kind: "integer", value: 1 }, subject: null, evidence, disclosure: "internal" } as const;
const results: ActionResult<typeof outcomeSchema>[] = [
  { type: "opaque_info", semanticClass: "information_authorized", origin: { capabilityId: "one" }, subject, evidence: [evidence], facts: [amount, internal] },
  { type: "opaque_options", semanticClass: "options_found", origin: { capabilityId: "two" }, subject: null, evidence: [evidence], facts: [], options: [{ id: "w1", subject: optionSubject, facts: [{ key: "window_label", value: { kind: "display_text", value: "15:00" }, subject: optionSubject, evidence, disclosure: "allowed" }] }] },
  { type: "opaque_completed", semanticClass: "effect_completed", origin: { capabilityId: "three" }, subject, evidence: [evidence], facts: [amount] },
  { type: "opaque_failed", semanticClass: "effect_failed", origin: { capabilityId: "four" }, subject: null, evidence: [], facts: [] },
  { type: "opaque_human", semanticClass: "human_action_required", origin: { capabilityId: "five" }, subject: null, evidence: [], facts: [] },
  { type: "opaque_clarify", semanticClass: "clarification_required", origin: { capabilityId: "six" }, subject: null, evidence: [], facts: [] },
];
const plan = buildV2AuthorizedResponsePlan(outcomeSchema, results);

describe("composer determinístico V2", () => {
  it("organiza cada outcome no único speech act compatível e preserva a ordem", async () => {
    const composer = new DeterministicResponseComposer();

    await expect(composer.compose({
      plan,
      style: { tone: "warm", verbosity: "standard", greeting: "include", emoji: "light" },
    })).resolves.toEqual({
      acts: [
        { kind: "inform_fact", outcomeRef: "outcome-0", factRef: "fact-0", subjectRef: "subject-0" },
        { kind: "offer_options", outcomeRef: "outcome-1", subjectRef: null, optionRefs: ["option-0"] },
        { kind: "confirm_effect", outcomeRef: "outcome-2", subjectRef: "subject-0", factRefs: ["fact-3"] },
        { kind: "communicate_failure", outcomeRef: "outcome-3", subjectRef: null },
        { kind: "inform_required_action", outcomeRef: "outcome-4", subjectRef: null },
        { kind: "ask_clarification", outcomeRef: "outcome-5", subjectRef: null },
      ],
    });
  });

  it("não transforma fact interno em speech act", async () => {
    const composer = new DeterministicResponseComposer();
    const draft = await composer.compose({
      plan,
      style: { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" },
    });

    expect(draft.acts).not.toContainEqual(expect.objectContaining({ factRef: "fact-1" }));
  });
});
