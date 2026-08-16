import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { runTurnPipeline } from "@/conversation-core/turn-pipeline";
import { fixturePack, fixtureUnderstanding } from "@/domain-packs/fixture";

const style = { tone: "neutral", verbosity: "concise", greeting: "omit", emoji: "none" } as const;
const composer = new DeterministicResponseComposer();
const response = { style, composer };

describe("fixture-pack no pipeline V2", () => {
  it("declara jornadas e ordem sem ensinar o domínio ao core", () => {
    expect(fixturePack.journeys).toEqual([
      { id: "quote", capabilityIds: ["glow-kite-quote"] },
      { id: "reservation", capabilityIds: ["wind-window-reservation"] },
    ]);
  });

  it("fecha o turno inteiro por composição sem conhecimento do domínio no core", async () => {
    const result = await runTurnPipeline({
      gateInput: {
        automationEnabled: true,
        duplicate: false,
        humanControlled: false,
        optedOut: false,
      },
      state: { phase: "ready", pendingStepId: null, completedStepIds: [] },
      policy: { quoteUnitAmount: 37 },
      now: new Date("2026-08-16T12:00:00.000Z"),
      understand: async () => fixtureUnderstanding("quote_glow_kite"),
      capabilities: fixturePack.capabilities,
      outcomeSchema: fixturePack.outcomeSchema,
      buildPlan: buildV2AuthorizedResponsePlan,
      response,
    });

    expect(result).toEqual({
      status: "delivered",
      capabilityIds: ["glow-kite-quote"],
      actionResults: [expect.objectContaining({
        type: "quote_prepared",
        semanticClass: "information_authorized",
        subject: { type: "fixture_item", id: "glow-kite" },
        facts: [{
          key: "unit_amount", value: 37,
          subject: { type: "fixture_item", id: "glow-kite" },
          evidence: { source: "policy", reference: "quote_unit_amount" },
          disclosure: "allowed",
        }],
      })],
      response: { text: "Informação: 37.", parts: [] },
    });
  });

  it("troca de jornada usando a segunda capability sem alteração no core", async () => {
    const result = await runTurnPipeline({
      gateInput: {
        automationEnabled: true,
        duplicate: false,
        humanControlled: false,
        optedOut: false,
      },
      state: { phase: "ready", pendingStepId: null, completedStepIds: [] },
      policy: { quoteUnitAmount: 37 },
      now: new Date("2026-08-16T12:00:00.000Z"),
      understand: async () => fixtureUnderstanding("reserve_wind_window"),
      capabilities: fixturePack.capabilities,
      outcomeSchema: fixturePack.outcomeSchema,
      buildPlan: buildV2AuthorizedResponsePlan,
      response,
    });

    expect(result.status).toBe("delivered");
    if (result.status !== "delivered") throw new Error("expected delivered result");
    expect(result.capabilityIds).toEqual(["wind-window-reservation"]);
    expect(result.actionResults).toEqual([expect.objectContaining({
      type: "wind_window_reserved", semanticClass: "effect_completed",
      subject: { type: "fixture_window", id: "wind-window" }, facts: [],
    })]);
  });
});
