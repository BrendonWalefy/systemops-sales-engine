import type {
  ConversationStateMachine,
  ConversationStateRow,
  DepositFlowPayload,
  TreatmentPipelinePayload,
} from "@/core/conversation/ConversationStateMachine";
import type { SlotReservationService } from "@/core/scheduling/SlotReservationService";
import type { Message } from "@/domain/entities/conversation";
import type { MediaAsset } from "@/domain/entities/media-asset";
import type { Treatment, PipelineStep } from "@/domain/entities/treatment";
import type { MediaAssetRepository } from "@/domain/repositories/media-asset-repository";
import type { TreatmentRepository } from "@/domain/repositories/treatment-repository";
import { buildDepositProofReceivedMessage } from "@/core/conversation/DepositTemplates";
import { buildHumanReviewPendingLeadMessage } from "@/domain/entities/human-review";
import type {
  DentalJourneyDeliveryPart,
  DentalJourneyDeliveryPlan,
  DentalJourneyMediaResolution,
  DentalJourneyReadPort,
  DentalJourneyResolution,
  DentalJourneyWriteOutcome,
  DentalJourneyWritePort,
} from "@/domain-packs/dental/ports";

type JourneyState = Pick<
  ConversationStateMachine,
  | "getCurrentState"
  | "startTreatmentPipelineForTurn"
  | "markPipelinePhotoReceivedForTurn"
  | "getDepositState"
  | "markDepositProofReceivedForTurn"
  | "invalidateIfCurrent"
>;

export type DentalJourneyLiveAdapterDependencies = Readonly<{
  clinicId: string;
  leadId: string;
  conversationId: string;
  turnId: string;
  now: Date;
  depositReservationTtlMinutes: number;
  inboundMessage: Pick<Message, "id" | "mediaType" | "mediaUrl">;
  history: readonly Message[];
  treatments: Pick<TreatmentRepository, "listByClinic">;
  mediaAssets: Pick<MediaAssetRepository, "findByIds">;
  state: JourneyState;
  reservations: Pick<SlotReservationService, "release" | "extend" | "findById">;
  depositProofReviews: Readonly<{
    nextAvailableCode(clinicId: string): Promise<number>;
  }>;
  humanReviews: Readonly<{
    findPendingByConversation(input: Readonly<{
      clinicId: string;
      conversationId: string;
    }>): Promise<Readonly<{
      id: string;
      clinicId: string;
      conversationId: string;
      leadId: string;
      treatmentId: string | null;
      targetTreatmentId: string | null;
      reviewCode: number;
      expiresAt: Date | null;
    }> | null>;
    createPending(input: Readonly<{
      clinicId: string;
      conversationId: string;
      leadId: string;
      sourceMessageId: string | null;
      treatmentId: string | null;
      targetTreatmentId: string | null;
      sourceMediaType: "image" | "video" | "document" | null;
      sourceMediaUrl: string | null;
      expiresAt?: Date | null;
    }>): Promise<Readonly<{
      id: string;
      clinicId: string;
      conversationId: string;
      leadId: string;
      treatmentId: string | null;
      targetTreatmentId: string | null;
      reviewCode: number;
      expiresAt: Date | null;
    }>>;
  }>;
  effectLifecycle?: Readonly<{ attempted(): void; completed(): void }>;
}>;

type PreparedStep = Readonly<{
  resolutionId: string;
  treatment: Treatment;
  selectedTreatment: Treatment;
  step: PipelineStep;
  stepIndex: number;
  stateId: string | null;
  plan: DentalJourneyDeliveryPlan;
}>;

type PreparedMedia =
  | Readonly<{
      kind: "journey_media";
      resolutionId: string;
      state: ConversationStateRow;
      treatment: Treatment;
      stepIndex: number;
    }>
  | Readonly<{
      kind: "deposit_proof";
      resolutionId: string;
      state: ConversationStateRow;
      payload: DepositFlowPayload;
    }>;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
    .replace(/\s+/g, " ");
}

function pipelinePayload(row: ConversationStateRow | null): TreatmentPipelinePayload | null {
  return row?.state === "treatment_pipeline_active"
    ? row.payload as TreatmentPipelinePayload
    : null;
}

function activeSourceTreatment(
  selected: Treatment,
  treatments: readonly Treatment[],
): Treatment | null {
  if (!selected.pipelineSourceTreatmentId) return selected;
  const source = treatments.find(({ id }) => id === selected.pipelineSourceTreatmentId);
  return source?.pipelineSteps?.length ? source : null;
}

function mediaAllowedForTreatment(
  asset: MediaAsset,
  clinicId: string,
  sourceTreatmentId: string,
  selectedTreatmentId: string,
): boolean {
  return asset.clinicId === clinicId
    && (asset.treatmentId === null
      || asset.treatmentId === sourceTreatmentId
      || asset.treatmentId === selectedTreatmentId)
    && (asset.type === "image" || asset.type === "video");
}

function nextAdvance(
  treatment: Treatment,
  stepIndex: number,
): DentalJourneyDeliveryPlan["pipelineAdvance"] {
  if (!treatment.pipelineSteps || stepIndex + 1 >= treatment.pipelineSteps.length) {
    return {
      action: "exit",
      expectedTreatmentId: treatment.id,
      expectedStepIndex: stepIndex,
    };
  }
  return {
    action: "advance",
    nextStepIndex: stepIndex + 1,
    expectedTreatmentId: treatment.id,
    expectedStepIndex: stepIndex,
  };
}

function readyResolution(prepared: PreparedStep): DentalJourneyResolution {
  return {
    kind: "ready",
    resolutionId: prepared.resolutionId,
    subjectId: `${prepared.treatment.id}:step:${prepared.stepIndex}`,
    subjectLabel: prepared.step.label,
    evidenceRef: `treatment:${prepared.treatment.id}:pipeline:${prepared.stepIndex}`,
  };
}

export function createDentalJourneyLiveAdapter(
  deps: DentalJourneyLiveAdapterDependencies,
): Readonly<{
  journeyRead: DentalJourneyReadPort;
  journeyWrite: DentalJourneyWritePort;
}> {
  const prepared = new Map<string, PreparedStep>();
  const preparedMedia = new Map<string, PreparedMedia>();
  let deliveryPlan: DentalJourneyDeliveryPlan | null = null;

  async function tenantTreatments(): Promise<readonly Treatment[]> {
    const rows = await deps.treatments.listByClinic(deps.clinicId);
    if (rows.some(({ clinicId }) => clinicId !== deps.clinicId)) {
      throw new Error("journey treatment tenant mismatch");
    }
    return rows;
  }

  async function buildPreparedStep(input: Readonly<{
    treatments: readonly Treatment[];
    source: Treatment;
    selected: Treatment;
    stepIndex: number;
    stateId: string | null;
  }>): Promise<PreparedStep | { reason: string }> {
    const step = input.source.pipelineSteps?.[input.stepIndex];
    if (!step) return { reason: "journey_step_missing" };
    let parts: DentalJourneyDeliveryPart[];
    let replyText: string;
    let advance: DentalJourneyDeliveryPlan["pipelineAdvance"] = null;

    if (step.type === "content") {
      const mediaIds = [...new Set(step.blocks.flatMap((block) =>
        block.kind === "media" ? [block.mediaId] : []))];
      const assets = await deps.mediaAssets.findByIds(deps.clinicId, mediaIds);
      const byId = new Map(assets.map((asset) => [asset.id, asset]));
      if (assets.some(({ clinicId }) => clinicId !== deps.clinicId)) {
        return { reason: "journey_media_tenant_mismatch" };
      }
      if (mediaIds.some((id) => !byId.has(id))) {
        return { reason: "journey_media_missing" };
      }
      parts = [];
      for (const block of step.blocks) {
        if (block.kind === "text") {
          const content = block.content.trim();
          if (content) parts.push({ type: "text", content });
          continue;
        }
        const asset = byId.get(block.mediaId)!;
        if (!mediaAllowedForTreatment(
          asset,
          deps.clinicId,
          input.source.id,
          input.selected.id,
        )) {
          return {
            reason: asset.clinicId !== deps.clinicId
              ? "journey_media_tenant_mismatch"
              : "journey_media_scope_mismatch",
          };
        }
        if (asset.type !== "image" && asset.type !== "video") {
          return { reason: "journey_media_type_unsupported" };
        }
        parts.push({
          type: "media",
          mediaId: asset.id,
          url: asset.url,
          mediaType: asset.type,
          title: asset.title,
          ...(block.caption ? { caption: block.caption } : {}),
        });
      }
      replyText = parts
        .filter((part): part is Extract<DentalJourneyDeliveryPart, { type: "text" }> =>
          part.type === "text")
        .map(({ content }) => content)
        .join("\n\n");
      if (parts.length === 0 || !replyText) return { reason: "journey_content_empty" };
      advance = nextAdvance(input.source, input.stepIndex);
    } else if (step.type === "photo") {
      replyText = step.message.trim();
      if (!replyText) return { reason: "journey_photo_request_empty" };
      parts = [{ type: "text", content: replyText }];
    } else {
      return { reason: `journey_step_${step.type}_owned_elsewhere` };
    }

    const resolutionId = [
      "journey",
      deps.turnId,
      input.source.id,
      input.stepIndex,
      input.stateId ?? "start",
    ].join(":");
    return {
      resolutionId,
      treatment: input.source,
      selectedTreatment: input.selected,
      step,
      stepIndex: input.stepIndex,
      stateId: input.stateId,
      plan: {
        replyText,
        interleavedParts: Object.freeze(parts),
        pipelineAdvance: advance,
        deterministic: true,
      },
    };
  }

  async function resolveStart(serviceQuery: string): Promise<DentalJourneyResolution> {
    const treatments = await tenantTreatments();
    const query = normalize(serviceQuery);
    const matches = treatments.filter((treatment) =>
      [treatment.name, ...treatment.aliases].some((value) => normalize(value) === query));
    if (matches.length !== 1) {
      return {
        kind: "unavailable",
        reason: matches.length === 0 ? "journey_not_configured" : "journey_service_ambiguous",
      };
    }
    const selected = matches[0]!;
    const source = activeSourceTreatment(selected, treatments);
    if (!source?.pipelineSteps?.length) {
      return { kind: "unavailable", reason: "journey_not_configured" };
    }
    const current = await deps.state.getCurrentState(deps.conversationId);
    const currentPayload = pipelinePayload(current);
    if (currentPayload && currentPayload.treatmentId !== source.id) {
      return { kind: "unavailable", reason: "different_journey_already_active" };
    }
    const stepIndex = currentPayload?.stepIndex ?? 0;
    const built = await buildPreparedStep({
      treatments,
      source,
      selected,
      stepIndex,
      stateId: current?.id ?? null,
    });
    if ("reason" in built) return { kind: "unavailable", reason: built.reason };
    prepared.set(built.resolutionId, built);
    return readyResolution(built);
  }

  async function resolveCurrentStep(): Promise<DentalJourneyResolution> {
    const current = await deps.state.getCurrentState(deps.conversationId);
    const payload = pipelinePayload(current);
    if (!current || !payload) {
      return { kind: "unavailable", reason: "journey_not_active" };
    }
    const treatments = await tenantTreatments();
    const source = treatments.find(({ id }) => id === payload.treatmentId);
    const selected = payload.selectedTreatmentId
      ? treatments.find(({ id }) => id === payload.selectedTreatmentId)
      : source;
    if (!source || !selected) {
      return { kind: "unavailable", reason: "journey_treatment_missing" };
    }
    const built = await buildPreparedStep({
      treatments,
      source,
      selected,
      stepIndex: payload.stepIndex,
      stateId: current.id,
    });
    if ("reason" in built) return { kind: "unavailable", reason: built.reason };
    prepared.set(built.resolutionId, built);
    return readyResolution(built);
  }

  const journeyRead: DentalJourneyReadPort = {
    resolveStart,
    resolveCurrentStep,
    async resolveInboundMedia(): Promise<DentalJourneyMediaResolution> {
      const mediaType = deps.inboundMessage.mediaType;
      const current = await deps.state.getCurrentState(deps.conversationId);
      if (!current || current.conversationId !== deps.conversationId) {
        return { kind: "unavailable", reason: "journey_media_state_missing" };
      }
      if (
        current.state === "awaiting_deposit_proof"
        && (mediaType === "image" || mediaType === "document")
      ) {
        if (
          !Number.isInteger(deps.depositReservationTtlMinutes)
          || deps.depositReservationTtlMinutes <= 0
        ) {
          return { kind: "unavailable", reason: "deposit_configuration_incomplete" };
        }
        const payload = current.payload as DepositFlowPayload | null;
        if (!payload?.reservationId) {
          return { kind: "unavailable", reason: "deposit_reservation_missing" };
        }
        const reservation = await deps.reservations.findById(payload.reservationId);
        if (
          !reservation
          || reservation.clinicId !== deps.clinicId
          || reservation.leadId !== deps.leadId
          || reservation.status !== "pending"
          || reservation.startsAt.toISOString() !== payload.slotStartsAt
          || reservation.endsAt.toISOString() !== payload.slotEndsAt
        ) {
          return { kind: "unavailable", reason: "deposit_reservation_mismatch" };
        }
        const resolutionId = `deposit-proof:${deps.turnId}:${current.id}:${deps.inboundMessage.id}`;
        preparedMedia.set(resolutionId, {
          kind: "deposit_proof",
          resolutionId,
          state: current,
          payload,
        });
        return {
          kind: "ready",
          mediaKind: "deposit_proof",
          resolutionId,
          subjectId: payload.reservationId,
          subjectLabel: payload.slotLabel,
          evidenceRef: `conversation-state:${current.id}`,
        };
      }
      if (
        current.state === "treatment_pipeline_active"
        && (mediaType === "image" || mediaType === "video")
      ) {
        const payload = pipelinePayload(current);
        const treatments = await tenantTreatments();
        const treatment = payload
          ? treatments.find(({ id }) => id === payload.treatmentId)
          : null;
        const step = treatment?.pipelineSteps?.[payload?.stepIndex ?? -1];
        if (!payload || !treatment || step?.type !== "photo" || payload.photoReceived) {
          return { kind: "unavailable", reason: "journey_photo_not_expected" };
        }
        const resolutionId = `journey-media:${deps.turnId}:${current.id}:${deps.inboundMessage.id}`;
        preparedMedia.set(resolutionId, {
          kind: "journey_media",
          resolutionId,
          state: current,
          treatment,
          stepIndex: payload.stepIndex,
        });
        return {
          kind: "ready",
          mediaKind: "journey_media",
          resolutionId,
          subjectId: `${treatment.id}:step:${payload.stepIndex}`,
          subjectLabel: step.label,
          evidenceRef: `conversation-state:${current.id}`,
        };
      }
      return { kind: "unavailable", reason: "journey_media_not_expected" };
    },
  };

  const journeyWrite: DentalJourneyWritePort = {
    async prepareStep(resolutionId): Promise<DentalJourneyWriteOutcome> {
      const candidate = prepared.get(resolutionId);
      if (!candidate) {
        return {
          success: false,
          reason: "journey_resolution_not_prepared",
          evidenceRef: `journey:${deps.turnId}:unprepared`,
        };
      }
      prepared.delete(resolutionId);
      let current = await deps.state.getCurrentState(deps.conversationId);
      let payload = pipelinePayload(current);
      if (!payload) {
        deps.effectLifecycle?.attempted();
        const started = await deps.state.startTreatmentPipelineForTurn({
          conversationId: deps.conversationId,
          turnId: deps.turnId,
          treatmentId: candidate.treatment.id,
          treatmentName: candidate.treatment.name,
          ttlMinutes: 240,
          stepIndex: candidate.stepIndex,
          selectedTreatment: candidate.selectedTreatment.id === candidate.treatment.id
            ? null
            : {
                id: candidate.selectedTreatment.id,
                name: candidate.selectedTreatment.name,
              },
          expectedCurrentStateId: candidate.stateId,
        });
        deps.effectLifecycle?.completed();
        current = started.state;
        payload = pipelinePayload(current);
      }
      if (
        !current
        || !payload
        || payload.treatmentId !== candidate.treatment.id
        || payload.stepIndex !== candidate.stepIndex
      ) {
        return {
          success: false,
          reason: "journey_state_changed",
          evidenceRef: `journey:${deps.turnId}:state_changed`,
        };
      }
      deliveryPlan = candidate.plan;
      return {
        success: true,
        kind: "journey_step_ready",
        subjectId: `${candidate.treatment.id}:step:${candidate.stepIndex}`,
        subjectLabel: candidate.step.label,
        evidenceRef: `conversation-state:${current.id}`,
      };
    },
    async receiveMedia(resolutionId): Promise<DentalJourneyWriteOutcome> {
      const candidate = preparedMedia.get(resolutionId);
      if (!candidate) {
        return {
          success: false,
          reason: "journey_media_resolution_not_prepared",
          evidenceRef: `journey:${deps.turnId}:media_unprepared`,
        };
      }
      preparedMedia.delete(resolutionId);
      deps.effectLifecycle?.attempted();
      if (candidate.kind === "deposit_proof") {
        const proofReviewCode = await deps.depositProofReviews.nextAvailableCode(deps.clinicId);
        const reviewExpiresAt = new Date(deps.now.getTime() + 7 * 24 * 3600_000);
        const transitioned = await deps.state.markDepositProofReceivedForTurn({
          conversationId: deps.conversationId,
          turnId: deps.turnId,
          expectedCurrentStateId: candidate.state.id,
          sourceMessageId: deps.inboundMessage.id,
          proofReviewCode,
          reviewExpiresAt,
        });
        const persisted = transitioned.state?.state === "deposit_proof_received"
          ? transitioned.state.payload as DepositFlowPayload | null
          : null;
        if (
          !persisted
          || persisted.proofMessageId !== deps.inboundMessage.id
          || persisted.reservationId !== candidate.payload.reservationId
        ) {
          return {
            success: false,
            reason: "deposit_proof_state_changed",
            evidenceRef: `deposit-proof:${deps.turnId}:state_changed`,
          };
        }
        await deps.reservations.extend(
          candidate.payload.reservationId!,
          deps.depositReservationTtlMinutes,
        );
        const replyText = buildDepositProofReceivedMessage();
        deliveryPlan = {
          replyText,
          interleavedParts: [{ type: "text", content: replyText }],
          pipelineAdvance: null,
          deterministic: true,
          postDeliveryControl: {
            kind: "attention",
            reason: "v2_deposit_proof_review_required",
          },
        };
        deps.effectLifecycle?.completed();
        return {
          success: true,
          kind: "deposit_proof_received",
          subjectId: candidate.payload.reservationId!,
          subjectLabel: candidate.payload.slotLabel,
          evidenceRef: `conversation-state:${transitioned.state!.id}`,
        };
      }

      const existingReview = await deps.humanReviews.findPendingByConversation({
        clinicId: deps.clinicId,
        conversationId: deps.conversationId,
      });
      const reviewExpiresAt = new Date(deps.now.getTime() + 24 * 3600_000);
      const review = existingReview ?? await deps.humanReviews.createPending({
        clinicId: deps.clinicId,
        conversationId: deps.conversationId,
        leadId: deps.leadId,
        sourceMessageId: deps.inboundMessage.id,
        treatmentId: candidate.treatment.id,
        targetTreatmentId: candidate.treatment.id,
        sourceMediaType: deps.inboundMessage.mediaType as "image" | "video",
        sourceMediaUrl: deps.inboundMessage.mediaUrl ?? null,
        expiresAt: reviewExpiresAt,
      });
      if (
        review.clinicId !== deps.clinicId
        || review.conversationId !== deps.conversationId
        || review.leadId !== deps.leadId
        || review.treatmentId !== candidate.treatment.id
        || review.targetTreatmentId !== candidate.treatment.id
      ) {
        return {
          success: false,
          reason: "journey_review_binding_mismatch",
          evidenceRef: `journey:${deps.turnId}:review_mismatch`,
        };
      }
      const transitioned = await deps.state.markPipelinePhotoReceivedForTurn({
        conversationId: deps.conversationId,
        turnId: deps.turnId,
        expectedCurrentStateId: candidate.state.id,
        expectedTreatmentId: candidate.treatment.id,
        expectedStepIndex: candidate.stepIndex,
        sourceMessageId: deps.inboundMessage.id,
        reviewExpiresAt: review.expiresAt ?? reviewExpiresAt,
      });
      const persisted = pipelinePayload(transitioned.state);
      if (
        !persisted
        || !persisted.photoReceived
        || persisted.photoMessageId !== deps.inboundMessage.id
      ) {
        return {
          success: false,
          reason: "journey_photo_state_changed",
          evidenceRef: `journey:${deps.turnId}:photo_state_changed`,
        };
      }
      const replyText = buildHumanReviewPendingLeadMessage();
      deliveryPlan = {
        replyText,
        interleavedParts: [{ type: "text", content: replyText }],
        pipelineAdvance: null,
        deterministic: true,
        postDeliveryControl: {
          kind: "handoff",
          reason: "v2_journey_photo_review_required",
        },
      };
      deps.effectLifecycle?.completed();
      return {
        success: true,
        kind: "journey_media_received",
        subjectId: `${candidate.treatment.id}:step:${candidate.stepIndex}`,
        subjectLabel: candidate.treatment.name,
        evidenceRef: `human-review:${review.id}`,
      };
    },
    async releasePendingDeposit(): Promise<DentalJourneyWriteOutcome> {
      const current = await deps.state.getCurrentState(deps.conversationId);
      if (current?.state !== "awaiting_deposit_proof") {
        return {
          success: false,
          reason: current?.state === "deposit_proof_received"
            ? "deposit_change_requires_human"
            : "deposit_wait_not_active",
          evidenceRef: `deposit-change:${deps.turnId}:not_releasable`,
        };
      }
      const payload = current.payload as DepositFlowPayload | null;
      if (!payload?.reservationId) {
        return {
          success: false,
          reason: "deposit_reservation_missing",
          evidenceRef: `deposit-change:${deps.turnId}:reservation_missing`,
        };
      }
      const reservation = await deps.reservations.findById(payload.reservationId);
      if (
        !reservation
        || reservation.clinicId !== deps.clinicId
        || reservation.leadId !== deps.leadId
        || reservation.status !== "pending"
      ) {
        return {
          success: false,
          reason: "deposit_reservation_mismatch",
          evidenceRef: `deposit-change:${deps.turnId}:reservation_mismatch`,
        };
      }
      deps.effectLifecycle?.attempted();
      await deps.reservations.release(payload.reservationId);
      if (!await deps.state.invalidateIfCurrent(deps.conversationId, current.id)) {
        return {
          success: false,
          reason: "deposit_state_changed_after_release",
          evidenceRef: `deposit-change:${deps.turnId}:state_changed`,
        };
      }
      deps.effectLifecycle?.completed();
      return {
        success: true,
        kind: "deposit_change_released",
        subjectId: payload.reservationId,
        subjectLabel: payload.slotLabel,
        evidenceRef: `reservation:${payload.reservationId}:released`,
      };
    },
    takeDeliveryPlan() {
      const plan = deliveryPlan;
      deliveryPlan = null;
      return plan;
    },
  };

  return Object.freeze({ journeyRead, journeyWrite });
}
