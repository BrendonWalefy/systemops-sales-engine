import type {
  Capability,
  CapabilityClaim,
  ConversationState,
} from "@/conversation-core/capability/contract";
import type { Understanding } from "@/conversation-core/understanding/schema";
import type { OutcomeSchema } from "@/conversation-core/decision";

export type ClaimedCapability<
  Request extends string,
  Policy extends object,
  ClaimPayload extends object,
  Schema extends OutcomeSchema = OutcomeSchema,
> = {
  capability: Capability<Request, Policy, ClaimPayload, Schema>;
  claim: CapabilityClaim<ClaimPayload>;
};

export type CoordinationResult<
  Request extends string,
  Policy extends object,
  ClaimPayload extends object,
  Schema extends OutcomeSchema = OutcomeSchema,
> =
  | {
      outcome: "selected";
      claimed: ClaimedCapability<
        Request,
        Policy,
        ClaimPayload,
        Schema
      >[];
    }
  | { outcome: "conflict"; capabilityIds: string[] };

export function coordinateCapabilities<
  Request extends string,
  Policy extends object,
  ClaimPayload extends object,
  Schema extends OutcomeSchema,
>(input: {
  capabilities: readonly Capability<
    Request,
    Policy,
    ClaimPayload,
    Schema
  >[];
  understanding: Understanding<Request>;
  state: ConversationState;
}): CoordinationResult<Request, Policy, ClaimPayload, Schema> {
  const seen = new Set<string>();

  const claimed = input.capabilities.flatMap((capability) => {
    if (seen.has(capability.id)) {
      throw new Error(`duplicate capability id: ${capability.id}`);
    }
    seen.add(capability.id);

    const claim = capability.claim(input.understanding, input.state);
    if (!claim) return [];
    if (claim.capabilityId !== capability.id) {
      throw new Error(`claim owner mismatch: ${claim.capabilityId}`);
    }
    return [{ capability, claim }];
  });

  const selectedIds = new Set(claimed.map((item) => item.capability.id));
  const hasConflict = claimed.some((item) =>
    item.claim.conflictsWith?.some((id) => selectedIds.has(id)),
  );
  const hasMissingDependency = claimed.some((item) =>
    item.claim.dependsOn?.some((id) => !selectedIds.has(id)),
  );

  return hasConflict || hasMissingDependency
    ? { outcome: "conflict", capabilityIds: [...selectedIds] }
    : { outcome: "selected", claimed };
}
