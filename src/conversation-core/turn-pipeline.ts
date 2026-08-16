import type {
  Capability,
  CapabilityContext,
  ConversationState,
  StructuredPolicy,
} from "@/conversation-core/capability/contract";
import { coordinateCapabilities } from "@/conversation-core/capability/coordinator";
import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { CoreResponse } from "@/conversation-core/composer/contract";
import type { V2ResponsePipelineResult } from "@/conversation-core/composer/response-pipeline";
import type { ActionResult } from "@/conversation-core/decision";
import { evaluateTurnGate, type TurnGateInput } from "@/conversation-core/gate";
import type { Understanding } from "@/conversation-core/understanding/schema";

export type TurnPipelineResult =
  | { status: "suppressed"; reason: string }
  | { status: "needs_clarification" }
  | {
      status: "escalated";
      reason: "capability_conflict";
      capabilityIds: readonly string[];
    }
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
  ClaimPayload extends object,
>(input: {
  gateInput: TurnGateInput;
  state: ConversationState;
  policy: StructuredPolicy<Policy>;
  now: Date;
  understand(): Promise<Understanding<Request>>;
  capabilities: readonly Capability<Request, Policy, ClaimPayload>[];
  buildPlan(actionResults: readonly ActionResult[]): V2AuthorizedResponsePlan;
  respond(plan: V2AuthorizedResponsePlan): Promise<V2ResponsePipelineResult>;
}): Promise<TurnPipelineResult> {
  const gate = evaluateTurnGate(input.gateInput);
  if (gate.outcome === "suppress")
    return { status: "suppressed", reason: gate.reason };

  const understanding = await input.understand();
  const coordination = coordinateCapabilities({
    capabilities: input.capabilities,
    understanding,
    state: input.state,
  });
  if (coordination.outcome === "conflict") {
    return {
      status: "escalated",
      reason: "capability_conflict",
      capabilityIds: coordination.capabilityIds,
    };
  }
  const claimed = coordination.claimed;
  if (claimed.length === 0) return { status: "needs_clarification" };

  const context = {
    state: input.state,
    policy: input.policy,
    now: input.now,
  } as CapabilityContext<Policy>;
  // All authorized reads and deterministic decisions finish before the first
  // effect. A later read failure therefore cannot leave an earlier capability
  // partially executed.
  const decided = [];
  for (const item of claimed) {
    decided.push({
      capability: item.capability,
      decision: await item.capability.decide(item.claim, context),
    });
  }

  const actionResults: ActionResult[] = [];
  for (const item of decided) {
    actionResults.push(await item.capability.execute(item.decision, context));
  }

  const plan = input.buildPlan(actionResults);
  const responseResult = await input.respond(plan);
  if (responseResult.status === "no_safe_response")
    return { status: "rejected", actionResults };

  return {
    status: "delivered",
    capabilityIds: claimed.map((item) => item.capability.id),
    actionResults,
    response: responseResult.response,
  };
}
