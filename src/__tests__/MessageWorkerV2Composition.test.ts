import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V2OnlyAutomationPolicy } from "@/application/automation/v2-only-automation-policy";
import { createConversationV2Runtime } from "@/infrastructure/conversation-v2/create-conversation-v2-runtime";

function closedRuntimeInput() {
  return {
    env: {},
    clinicFactsReader: { getAutomationFacts: async () => null },
    conversationAuthorityStore: { getVersion: async () => 0 as const },
    conversationRuntimeControlStore: {
      getGlobal: async () => ({ liveOutboundEnabled: false, version: 0 }),
    },
  } as const;
}

describe("V2-only message worker composition", () => {
  it("composes one direct conversation handler and the reasoned V2 policy", () => {
    const handler = { handle: async () => ({ replied: false as const }) };
    const runtime = createConversationV2Runtime({
      ...closedRuntimeInput(),
      v2Handler: handler,
    });

    expect(runtime.conversationHandler).toBe(handler);
    expect(runtime.automationPolicy).toBeInstanceOf(V2OnlyAutomationPolicy);
    expect(runtime.decisionTraceSink).toBeDefined();
  });

  it("keeps the route thin and removes V1 observation and online shadow selection", () => {
    const source = readFileSync("src/app/api/cron/message-worker/route.ts", "utf8");

    expect(source).toContain("createConversationV2Runtime");
    expect(source).toContain("conversationHandler: conversationV2Runtime.conversationHandler");
    expect(source).toContain("automationPolicy: conversationV2Runtime.automationPolicy");
    expect(source).toContain("decisionTraceSink: conversationV2Runtime.decisionTraceSink");
    expect(source).not.toMatch(/createTurnObservationSink|runSelectedShadowTurns|drainCapturedTurns/);
    expect(source).not.toMatch(/runAfterSenderDrainAttempt|conversationV2Shadow|engine_selected/);
    expect(source).not.toMatch(/ConversationOrchestrator|TenantEngineRouter|shadowModeEnabled/);
    expect(source).not.toMatch(/Dental|bookSlot|confirmAppointment|OpenAI/);
  });

  it("uses the existing process and send queues without introducing a V2 worker", () => {
    const runtimeSource = readFileSync(
      "src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts",
      "utf8",
    );
    const routeSource = readFileSync("src/app/api/cron/message-worker/route.ts", "utf8");
    const source = `${runtimeSource}\n${routeSource}`;

    expect(source).not.toMatch(/v2\.process|v2\.send|V2Worker/);
    expect(routeSource.match(/new ProcessMessageJobHandler/g)).toHaveLength(1);
    expect(routeSource.match(/new SendMessageJobHandler/g)).toHaveLength(1);
  });
});
