import type { Capability, ConversationState } from "@/conversation-core/capability/contract";
import { coordinateCapabilities } from "@/conversation-core/capability/coordinator";
import type { ActionResult } from "@/conversation-core/decision";
import { evaluateTurnGate, type TurnGateInput } from "@/conversation-core/gate";
import type { Understanding } from "@/conversation-core/understanding/schema";

export type CoreResponse = { text: string; parts: readonly unknown[] };

export type TurnPipelineResult =
  | { status: "suppressed"; reason: string }
  | { status: "needs_clarification" }
  | { status: "rejected"; actionResults: readonly ActionResult[] }
  | {
      status: "delivered";
      capabilityIds: readonly string[];
      actionResults: readonly ActionResult[];
      response: CoreResponse;
    };

export async function runTurnPipeline<
  Request extends string,
  Policy extends object,
  Plan,
>(input: {
  gateInput: TurnGateInput;
  state: ConversationState;
  policy: Readonly<Policy>;
  now: Date;
  understand(): Promise<Understanding<Request>>;
  capabilities: readonly Capability<Request, Policy>[];
  buildPlan(actionResults: readonly ActionResult[]): Plan;
  compose(plan: Plan): Promise<CoreResponse>;
  validate(input: { plan: Plan; response: CoreResponse }): boolean;
}): Promise<TurnPipelineResult> {
  const gate = evaluateTurnGate(input.gateInput);
  if (gate.outcome === "suppress") return { status: "suppressed", reason: gate.reason };

  const understanding = await input.understand();
  const claimed = coordinateCapabilities({
    capabilities: input.capabilities,
    understanding,
    state: input.state,
  });
  if (claimed.length === 0) return { status: "needs_clarification" };

  const context = { state: input.state, policy: input.policy, now: input.now };
  const actionResults: ActionResult[] = [];
  for (const item of claimed) {
    const decision = await item.capability.decide(item.claim, context);
    actionResults.push(await item.capability.execute(decision, context));
  }

  const plan = input.buildPlan(actionResults);
  const response = await input.compose(plan);
  if (!input.validate({ plan, response })) return { status: "rejected", actionResults };

  return {
    status: "delivered",
    capabilityIds: claimed.map((item) => item.capability.id),
    actionResults,
    response,
  };
}
