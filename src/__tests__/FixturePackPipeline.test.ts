import { describe, expect, it } from "vitest";
import { runTurnPipeline } from "@/conversation-core/turn-pipeline";
import { fixturePack, fixtureUnderstanding } from "@/domain-packs/fixture";

describe("fixture-pack no pipeline V2", () => {
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
      buildPlan: (actionResults) => ({
        facts: actionResults.flatMap((actionResult) => actionResult.facts),
      }),
      compose: async (plan) => ({
        text: `A unidade luminosa custa ${String(plan.facts[0]?.value)} créditos.`,
        parts: [],
      }),
      validate: ({ response }) => response.text === "A unidade luminosa custa 37 créditos.",
    });

    expect(result).toEqual({
      status: "delivered",
      capabilityIds: ["glow-kite-quote"],
      actionResults: [{
        type: "quote_prepared",
        facts: [{ key: "unit_amount", value: 37 }],
      }],
      response: { text: "A unidade luminosa custa 37 créditos.", parts: [] },
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
      buildPlan: (actionResults) => ({ facts: actionResults.flatMap((item) => item.facts) }),
      compose: async () => ({ text: "Janela de vento reservada.", parts: [] }),
      validate: () => true,
    });

    expect(result.status).toBe("delivered");
    if (result.status !== "delivered") throw new Error("expected delivered result");
    expect(result.capabilityIds).toEqual(["wind-window-reservation"]);
    expect(result.actionResults).toEqual([{ type: "wind_window_reserved", facts: [] }]);
  });
});
