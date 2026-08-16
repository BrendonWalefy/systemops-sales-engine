import type { Capability } from "@/conversation-core/capability/contract";

export type DomainPack<Request extends string, Policy extends object> = {
  id: string;
  capabilities: readonly Capability<Request, Policy>[];
  journeys: readonly { id: string; capabilityIds: readonly string[] }[];
};
