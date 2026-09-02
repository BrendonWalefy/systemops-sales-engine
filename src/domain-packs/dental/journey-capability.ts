import type { Capability } from "@/conversation-core/capability/contract";
import type { ActionResult, Decision } from "@/conversation-core/decision";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type {
  DentalJourneyReadPort,
  DentalJourneyWritePort,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

export function createDentalJourneyCapability(
  readPort: DentalJourneyReadPort,
  writePort: DentalJourneyWritePort,
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  void readPort;
  void writePort;
  return {
    id: "dental-journey",
    claim() {
      return null;
    },
    async decide(): Promise<Decision> {
      return { kind: "ask", questionId: "journey-unavailable" };
    },
    async execute(): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      return {
        type: "journey_failed",
        semanticClass: "effect_failed",
        origin: { capabilityId: "dental-journey" },
        subject: null,
        evidence: [],
        facts: [],
      };
    },
  };
}
