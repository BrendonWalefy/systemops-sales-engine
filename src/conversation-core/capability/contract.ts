import type { ActionResult, Decision } from "@/conversation-core/decision";
import type { Understanding } from "@/conversation-core/understanding/schema";

export type ConversationState = {
  phase: string;
  pendingStepId: string | null;
  completedStepIds: readonly string[];
};

type IsAny<Value> = 0 extends 1 & Value ? true : false;

export type CapabilityClaim<Payload extends object = Record<never, never>> =
  unknown extends Payload
    ? never
    : {
        capabilityId: string;
        confidence: number;
        reason: string;
        payload: Readonly<Payload>;
        conflictsWith?: readonly string[];
        dependsOn?: readonly string[];
      };

type StructuredPolicyValue<Value> =
  IsAny<Value> extends true
    ? never
    : Value extends string
      ? never
      : Value extends boolean | number | null
        ? Value
        : Value extends readonly (infer Item)[]
          ? readonly StructuredPolicyValue<Item>[]
          : Value extends object
            ? {
                readonly [Key in keyof Value]: StructuredPolicyValue<
                  Value[Key]
                >;
              }
            : never;

export type StructuredPolicy<Policy extends object> = {
  readonly [Key in keyof Policy]: StructuredPolicyValue<Policy[Key]>;
};

export type CapabilityContext<Policy extends object = Record<string, never>> =
  unknown extends Policy
    ? never
    : {
        state: ConversationState;
        policy: StructuredPolicy<Policy>;
        now: Date;
      };

export interface Capability<
  Request extends string = string,
  Policy extends object = Record<string, never>,
  ClaimPayload extends object = Record<never, never>,
> {
  readonly id: string;
  claim(
    understanding: Understanding<Request>,
    state: ConversationState,
  ): CapabilityClaim<ClaimPayload> | null;
  decide(
    claim: CapabilityClaim<ClaimPayload>,
    context: CapabilityContext<Policy>,
  ): Promise<Decision>;
  execute(
    decision: Decision,
    context: CapabilityContext<Policy>,
  ): Promise<ActionResult>;
}
