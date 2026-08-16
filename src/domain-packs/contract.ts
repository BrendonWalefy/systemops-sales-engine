import type { Capability } from "@/conversation-core/capability/contract";
import type { OutcomeSchema } from "@/conversation-core/decision";

export type DomainPack<
  Request extends string,
  Policy extends object,
  ClaimPayload extends object = Record<never, never>,
  Schema extends OutcomeSchema = OutcomeSchema,
> = {
  id: string;
  outcomeSchema: Schema;
  capabilities: readonly Capability<
    Request,
    Policy,
    ClaimPayload,
    Schema
  >[];
  journeys: readonly { id: string; capabilityIds: readonly string[] }[];
};
