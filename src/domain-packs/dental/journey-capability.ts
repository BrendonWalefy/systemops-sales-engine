import type {
  Capability,
  CapabilityClaim,
} from "@/conversation-core/capability/contract";
import type { ActionResult, Decision, Fact } from "@/conversation-core/decision";
import {
  DENTAL_OUTCOME_SCHEMA,
  type DentalClaimPayload,
  type DentalJourneyClaimPayload,
  type DentalPolicy,
} from "@/domain-packs/dental/capabilities";
import type {
  DentalJourneyReadPort,
  DentalJourneyWriteOutcome,
  DentalJourneyWritePort,
} from "@/domain-packs/dental/ports";
import type { DentalRequest } from "@/domain-packs/dental/vocabulary";

type DentalJourneyRequest = DentalJourneyClaimPayload["request"];

const journeyRequests = new Set<DentalJourneyRequest>([
  "start-treatment-journey",
  "continue-treatment-journey",
  "submit-journey-media",
  "submit-deposit-proof",
  "change-pending-deposit",
]);

function isJourneyRequest(request: DentalRequest): request is DentalJourneyRequest {
  return journeyRequests.has(request as DentalJourneyRequest);
}

function claimFor(
  request: DentalJourneyClaimPayload,
  confidence: number,
): CapabilityClaim<DentalClaimPayload> {
  return {
    capabilityId: "dental-journey",
    confidence,
    reason: `closed_request:${request.request}`,
    payload: request,
  };
}

function clarification(questionId: string): Decision {
  return { kind: "ask", questionId };
}

function effectFact(
  outcome: Exclude<DentalJourneyWriteOutcome, { success: false }>,
): Fact & {
  subject: NonNullable<Fact["subject"]>;
  evidence: Fact["evidence"] & { source: "write" };
} {
  const value = outcome.kind === "journey_step_ready"
    ? outcome.subjectLabel
    : outcome.kind === "journey_media_received"
      ? "Mídia recebida"
      : outcome.kind === "deposit_proof_received"
        ? "Comprovante recebido"
        : "Reserva provisória liberada";
  const key = outcome.kind === "journey_step_ready"
    ? "journey_step_label"
    : outcome.kind === "journey_media_received"
      ? "media_status"
      : outcome.kind === "deposit_proof_received"
        ? "proof_status"
        : "deposit_status";
  return {
    key,
    value: { kind: "display_text", value },
    subject: {
      type: outcome.kind.startsWith("deposit_") ? "deposit" : "journey_step",
      id: outcome.subjectId,
      displayName: outcome.subjectLabel,
    },
    evidence: { source: "write", reference: outcome.evidenceRef },
    disclosure: "allowed",
  };
}

function toActionResult(
  outcome: DentalJourneyWriteOutcome,
): ActionResult<typeof DENTAL_OUTCOME_SCHEMA> {
  if (!outcome.success) {
    return {
      type: "journey_failed",
      semanticClass: "effect_failed",
      origin: { capabilityId: "dental-journey" },
      subject: null,
      evidence: [{ source: "write", reference: outcome.evidenceRef }],
      facts: [],
    };
  }
  const fact = effectFact(outcome);
  const common = {
    origin: { capabilityId: "dental-journey" as const },
    subject: fact.subject,
    evidence: [fact.evidence] as const,
    facts: [fact] as const,
  };
  if (outcome.kind === "journey_step_ready") {
    return {
      ...common,
      type: "journey_step_ready",
      semanticClass: "information_authorized",
    };
  }
  if (outcome.kind === "journey_media_received") {
    return {
      ...common,
      type: "journey_media_received",
      semanticClass: "effect_completed",
    };
  }
  if (outcome.kind === "deposit_proof_received") {
    return {
      ...common,
      type: "deposit_proof_received",
      semanticClass: "effect_completed",
    };
  }
  return {
    ...common,
    type: "deposit_change_released",
    semanticClass: "effect_completed",
  };
}

export function createDentalJourneyCapability(
  readPort: DentalJourneyReadPort,
  writePort: DentalJourneyWritePort,
): Capability<
  DentalRequest,
  DentalPolicy,
  DentalClaimPayload,
  typeof DENTAL_OUTCOME_SCHEMA
> {
  return {
    id: "dental-journey",
    claim(understanding) {
      if (!understanding.request || !isJourneyRequest(understanding.request)) {
        return null;
      }
      if (understanding.request === "start-treatment-journey") {
        const service = understanding.entities.service;
        return claimFor({
          kind: "journey",
          request: understanding.request,
          serviceQuery: typeof service === "string" ? service : null,
        }, understanding.confidence);
      }
      return claimFor({
        kind: "journey",
        request: understanding.request,
      }, understanding.confidence);
    },
    async decide(claim): Promise<Decision> {
      if (claim.payload.kind !== "journey") {
        return clarification("invalid-journey-claim");
      }
      if (claim.payload.request === "change-pending-deposit") {
        return {
          kind: "execute",
          action: { type: "release-pending-deposit", parameters: {} },
          nextBestStep: null,
        };
      }
      const resolution = claim.payload.request === "start-treatment-journey"
        ? claim.payload.serviceQuery
          ? await readPort.resolveStart(claim.payload.serviceQuery)
          : { kind: "unavailable" as const, reason: "journey_service_required" }
        : claim.payload.request === "continue-treatment-journey"
          ? await readPort.resolveCurrentStep()
          : await readPort.resolveInboundMedia();
      if (resolution.kind === "unavailable") {
        return clarification(resolution.reason);
      }
      const actionType = "mediaKind" in resolution
        ? resolution.mediaKind === "deposit_proof"
          ? "receive-deposit-proof"
          : "receive-journey-media"
        : "prepare-journey-step";
      return {
        kind: "execute",
        action: {
          type: actionType,
          parameters: { resolutionId: resolution.resolutionId },
        },
        nextBestStep: null,
      };
    },
    async execute(decision): Promise<ActionResult<typeof DENTAL_OUTCOME_SCHEMA>> {
      if (decision.kind === "ask") {
        return {
          type: "clarification_required",
          semanticClass: "clarification_required",
          origin: { capabilityId: "dental-journey" },
          subject: null,
          evidence: [],
          facts: [],
        };
      }
      if (decision.kind !== "execute") {
        return toActionResult({
          success: false,
          reason: "invalid_journey_decision",
          evidenceRef: "journey:invalid_decision",
        });
      }
      if (decision.action.type === "release-pending-deposit") {
        return toActionResult(await writePort.releasePendingDeposit());
      }
      const resolutionId = decision.action.parameters.resolutionId;
      if (typeof resolutionId !== "string") {
        return toActionResult({
          success: false,
          reason: "invalid_journey_resolution",
          evidenceRef: "journey:invalid_resolution",
        });
      }
      if (decision.action.type === "prepare-journey-step") {
        return toActionResult(await writePort.prepareStep(resolutionId));
      }
      if (
        decision.action.type === "receive-journey-media"
        || decision.action.type === "receive-deposit-proof"
      ) {
        return toActionResult(await writePort.receiveMedia(resolutionId));
      }
      return toActionResult({
        success: false,
        reason: "unsupported_journey_action",
        evidenceRef: "journey:unsupported_action",
      });
    },
  };
}
