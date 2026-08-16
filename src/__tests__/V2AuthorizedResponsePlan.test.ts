import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { ActionResult } from "@/conversation-core/decision";

describe("plano autorizado V2", () => {
  it("preserva vínculo e evidência e remove facts internos", () => {
    const result: ActionResult = {
      type: "catalog_resolved",
      facts: [
        {
          key: "price_cents", value: 29_000,
          subject: { type: "service", id: "service-1" },
          evidence: { source: "read", reference: "catalog:service-1" },
          disclosure: "allowed",
        },
        {
          key: "match_score", value: 0.94, subject: null,
          evidence: { source: "derived", reference: "catalog-match.v1" },
          disclosure: "internal",
        },
      ],
    };

    expect(buildV2AuthorizedResponsePlan([result])).toEqual({
      version: "authorized-response-plan.v2",
      actionTypes: ["catalog_resolved"],
      authorizedFacts: [result.facts[0]],
    });
  });

  it("recusa fact divulgável sem subject", () => {
    const result: ActionResult = {
      type: "unsafe",
      facts: [{
        key: "price_cents", value: 29_000, subject: null,
        evidence: { source: "read", reference: "catalog" }, disclosure: "allowed",
      }],
    };
    expect(() => buildV2AuthorizedResponsePlan([result])).toThrow(/subject/);
  });
});
