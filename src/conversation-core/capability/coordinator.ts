import type {
  Capability,
  CapabilityClaim,
  ConversationState,
} from "@/conversation-core/capability/contract";
import type { Understanding } from "@/conversation-core/understanding/schema";

export type ClaimedCapability<
  Request extends string,
  Policy extends object,
> = {
  capability: Capability<Request, Policy>;
  claim: CapabilityClaim;
};

export function coordinateCapabilities<
  Request extends string,
  Policy extends object,
>(input: {
  capabilities: readonly Capability<Request, Policy>[];
  understanding: Understanding<Request>;
  state: ConversationState;
}): ClaimedCapability<Request, Policy>[] {
  const seen = new Set<string>();

  return input.capabilities.flatMap((capability) => {
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
}
