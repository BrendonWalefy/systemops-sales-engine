import { describe, expect, it } from "vitest";
import { NamedDecisionOverrideTracker } from "@/core/observability/NamedDecisionOverride";

describe("NamedDecisionOverrideTracker", () => {
  it("registra em ordem somente regras que mudaram a decisão", () => {
    const tracker = new NamedDecisionOverrideTracker<string>("greeting");
    tracker.apply("greeting", "business_intent_coercion");
    tracker.apply("price_inquiry", "quantity_price_followup");
    tracker.apply("needs_human", "uncatalogued_maintenance");

    expect(tracker.value).toBe("needs_human");
    expect(tracker.rules).toEqual([
      "quantity_price_followup",
      "uncatalogued_maintenance",
    ]);
  });

  it("devolve uma cópia imutável da lista de regras", () => {
    const tracker = new NamedDecisionOverrideTracker<string>("unclear");
    tracker.apply("general_question", "business_hours_question");
    const rules = tracker.rules as string[];
    rules.push("mutated_outside");
    expect(tracker.rules).toEqual(["business_hours_question"]);
  });
});
