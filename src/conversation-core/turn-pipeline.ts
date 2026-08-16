import type {
  Capability,
  CapabilityContext,
  ConversationState,
  StructuredPolicy,
} from "@/conversation-core/capability/contract";
import { coordinateCapabilities } from "@/conversation-core/capability/coordinator";
import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type {
  ComposerStyle,
  CoreResponse,
  ResponseComposerPort,
} from "@/conversation-core/composer/contract";
import { runV2ResponsePipeline } from "@/conversation-core/composer/response-pipeline";
import type {
  ActionResult,
  OutcomeSchema,
  OutcomeTypeOf,
} from "@/conversation-core/decision";
import { evaluateTurnGate, type TurnGateInput } from "@/conversation-core/gate";
import type { Understanding } from "@/conversation-core/understanding/schema";

export type TurnPipelineResult<Schema extends OutcomeSchema = OutcomeSchema> =
  | { status: "suppressed"; reason: string }
  | { status: "needs_clarification" }
  | {
      status: "escalated";
      reason: "capability_conflict";
      capabilityIds: readonly string[];
    }
  | { status: "rejected"; actionResults: readonly ActionResult<Schema>[] }
  | {
      status: "delivered";
      capabilityIds: readonly string[];
      actionResults: readonly ActionResult<Schema>[];
      response: CoreResponse;
    };

export async function runTurnPipeline<
  Request extends string,
  Policy extends object,
  ClaimPayload extends object,
  Schema extends OutcomeSchema,
>(input: {
  gateInput: TurnGateInput;
  state: ConversationState;
  policy: StructuredPolicy<Policy>;
  now: Date;
  understand(): Promise<Understanding<Request>>;
  capabilities: readonly Capability<
    Request,
    Policy,
    ClaimPayload,
    Schema
  >[];
  outcomeSchema: Schema;
  buildPlan(
    schema: Schema,
    actionResults: readonly ActionResult<Schema>[],
  ): V2AuthorizedResponsePlan<OutcomeTypeOf<Schema>>;
  response: {
    style: ComposerStyle;
    composer: ResponseComposerPort;
  };
}): Promise<TurnPipelineResult<Schema>> {
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

  const actionResults: ActionResult<Schema>[] = [];
  for (const item of decided) {
    actionResults.push(await item.capability.execute(item.decision, context));
  }

  const plan = input.buildPlan(input.outcomeSchema, actionResults);
  const responseResult = await runV2ResponsePipeline({
    plan,
    style: input.response.style,
    composer: input.response.composer,
  });
  if (responseResult.status === "no_safe_response")
    return { status: "rejected", actionResults };

  return {
    status: "delivered",
    capabilityIds: claimed.map((item) => item.capability.id),
    actionResults,
    response: responseResult.response,
  };
}
