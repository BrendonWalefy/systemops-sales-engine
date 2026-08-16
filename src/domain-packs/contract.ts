import type { Capability } from "@/conversation-core/capability/contract";

export type DomainPack<
  Request extends string,
  Policy extends object,
  ClaimPayload extends object = Record<never, never>,
> = {
  id: string;
  capabilities: readonly Capability<Request, Policy, ClaimPayload>[];
  journeys: readonly { id: string; capabilityIds: readonly string[] }[];
};
