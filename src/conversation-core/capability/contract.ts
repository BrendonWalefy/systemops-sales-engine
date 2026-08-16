import type { ActionResult, Decision } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";

export type ConversationState = {
  phase: string;
  pendingStepId: string | null;
  completedStepIds: readonly string[];
};

export type CapabilityClaim = {
  capabilityId: string;
  confidence: number;
  reason: string;
};

export type CapabilityContext<Policy extends object = Record<string, never>> = {
  state: ConversationState;
  policy: Readonly<Policy>;
  now: Date;
};

export interface Capability<
  Request extends string = string,
  Policy extends object = Record<string, never>,
> {
  readonly id: string;
  claim(
    understanding: Understanding<Request>,
    state: ConversationState,
  ): CapabilityClaim | null;
  decide(claim: CapabilityClaim, context: CapabilityContext<Policy>): Promise<Decision>;
  execute(decision: Decision, context: CapabilityContext<Policy>): Promise<ActionResult>;
}
