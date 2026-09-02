import { createHmac } from "node:crypto";
import type { Decision } from "@/conversation-core/decision";
import {
  dentalDecisionProvenanceIdentity,
  isDentalExecuteDecisionIdentity,
  type DentalExecuteDecisionIdentity,
} from "@/domain-packs/dental/outcome-provenance";

export type IntendedEffect = Readonly<{
  kind: "would_have_executed";
  capabilityId: "dental-scheduling" | "dental-appointment-lifecycle";
  payloadHash: string;
}> & (
  | Readonly<{ action: "book_slot" | "reschedule_slot"; payload: Readonly<{ slotRefHash: string }> }>
  | Readonly<{ action: "confirm_appointment" | "cancel_appointment"; payload: Readonly<{ appointmentRefHash: string }> }>
  | Readonly<{ action: "persist_slot_offer" | "persist_replacement_offer"; payload: Readonly<{ offerRefHash: string }> }>
);

export type DentalEffectDecisionIdentity =
  | DentalExecuteDecisionIdentity
  | Readonly<{
      capabilityId: "dental-scheduling";
      decisionKind: "offer";
      action: "persist_slot_offer";
    }>
  | Readonly<{
      capabilityId: "dental-appointment-lifecycle";
      decisionKind: "offer";
      action: "persist_replacement_offer";
    }>;

function hmac(hmacKey: string, value: string): string {
  return createHmac("sha256", hmacKey).update(value).digest("hex");
}

export function recordDentalIntendedEffect(input: {
  capabilityId: string;
  decision: Decision;
  hmacKey: string;
}): IntendedEffect | null {
  const identity = dentalDecisionProvenanceIdentity(input);
  if (!identity) return null;
  if (
    identity.capabilityId === "dental-scheduling" &&
    identity.decisionKind === "offer" &&
    input.decision.kind === "offer"
  ) {
    const optionRefHashes = input.decision.options.map((option) =>
      hmac(input.hmacKey, `dental-shadow:offer-option:${option.id}`),
    );
    const offerRefHash = hmac(
      input.hmacKey,
      `dental-shadow:offer:${input.decision.subject.id}:${optionRefHashes.join(":")}`,
    );
    return Object.freeze({
      kind: "would_have_executed",
      capabilityId: identity.capabilityId,
      action: "persist_slot_offer",
      payload: Object.freeze({ offerRefHash }),
      payloadHash: hmac(
        input.hmacKey,
        `dental-shadow:persist_slot_offer:${offerRefHash}`,
      ),
    });
  }
  if (
    identity.capabilityId === "dental-appointment-lifecycle" &&
    identity.decisionKind === "offer" &&
    input.decision.kind === "offer" &&
    input.decision.nextBestStep?.id === "choose-replacement-slot"
  ) {
    const offerRefHash = hmac(
      input.hmacKey,
      `dental-shadow:replacement-offer:${input.decision.subject.id}:${input.decision.options.map(({ id }) => id).join(":")}`,
    );
    return Object.freeze({
      kind: "would_have_executed",
      capabilityId: identity.capabilityId,
      action: "persist_replacement_offer",
      payload: Object.freeze({ offerRefHash }),
      payloadHash: hmac(input.hmacKey, `dental-shadow:persist_replacement_offer:${offerRefHash}`),
    });
  }
  if (input.decision.kind !== "execute" || identity.decisionKind !== "execute") {
    return null;
  }
  const { action } = input.decision;
  if (identity.action === "book_slot" && action.type === "book-slot") {
    const slotId = action.parameters.slotId;
    if (typeof slotId !== "string") return null;
    const slotRefHash = hmac(input.hmacKey, `dental-shadow:slot:${slotId}`);
    return Object.freeze({
      kind: "would_have_executed",
      capabilityId: identity.capabilityId,
      action: "book_slot",
      payload: Object.freeze({ slotRefHash }),
      payloadHash: hmac(input.hmacKey, `dental-shadow:book_slot:${slotRefHash}`),
    });
  }
  if (identity.action === "reschedule_slot" && action.type === "reschedule-slot") {
    const slotId = action.parameters.slotId;
    if (typeof slotId !== "string") return null;
    const slotRefHash = hmac(input.hmacKey, `dental-shadow:slot:${slotId}`);
    return Object.freeze({
      kind: "would_have_executed",
      capabilityId: identity.capabilityId,
      action: "reschedule_slot",
      payload: Object.freeze({ slotRefHash }),
      payloadHash: hmac(input.hmacKey, `dental-shadow:reschedule_slot:${slotRefHash}`),
    });
  }
  if (identity.action === "confirm_appointment" && action.type === "confirm-appointment") {
    const appointmentId = action.parameters.appointmentId;
    if (typeof appointmentId !== "string") return null;
    const appointmentRefHash = hmac(input.hmacKey, `dental-shadow:appointment:${appointmentId}`);
    return Object.freeze({
      kind: "would_have_executed",
      capabilityId: identity.capabilityId,
      action: "confirm_appointment",
      payload: Object.freeze({ appointmentRefHash }),
      payloadHash: hmac(input.hmacKey, `dental-shadow:confirm_appointment:${appointmentRefHash}`),
    });
  }
  if (identity.action === "cancel_appointment" && action.type === "cancel-appointment") {
    const appointmentId = action.parameters.appointmentId;
    if (typeof appointmentId !== "string") return null;
    const appointmentRefHash = hmac(input.hmacKey, `dental-shadow:appointment:${appointmentId}`);
    return Object.freeze({
      kind: "would_have_executed",
      capabilityId: identity.capabilityId,
      action: "cancel_appointment",
      payload: Object.freeze({ appointmentRefHash }),
      payloadHash: hmac(input.hmacKey, `dental-shadow:cancel_appointment:${appointmentRefHash}`),
    });
  }
  return null;
}

export function dentalEffectDecisionIdentity(input: {
  capabilityId: string;
  decision: Decision;
}): DentalEffectDecisionIdentity | null {
  const identity = dentalDecisionProvenanceIdentity(input);
  if (!identity) return null;
  if (identity.decisionKind === "execute") return identity;
  if (
    identity.capabilityId === "dental-appointment-lifecycle" &&
    identity.decisionKind === "offer" &&
    input.decision.kind === "offer" &&
    input.decision.nextBestStep?.id === "choose-replacement-slot"
  ) {
    return Object.freeze({
      capabilityId: identity.capabilityId,
      decisionKind: identity.decisionKind,
      action: "persist_replacement_offer" as const,
    });
  }
  return identity.capabilityId === "dental-scheduling" &&
      identity.decisionKind === "offer"
    ? Object.freeze({
        capabilityId: identity.capabilityId,
        decisionKind: identity.decisionKind,
        action: "persist_slot_offer" as const,
      })
    : null;
}

export function isDentalEffectDecisionIdentity(
  value: unknown,
): value is DentalEffectDecisionIdentity {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.capabilityId === "dental-scheduling" &&
    candidate.decisionKind === "offer" &&
    candidate.action === "persist_slot_offer"
  ) {
    return Reflect.ownKeys(candidate).length === 3 &&
      Reflect.ownKeys(candidate).every((key) => typeof key === "string");
  }
  if (
    candidate.capabilityId === "dental-appointment-lifecycle" &&
    candidate.decisionKind === "offer" &&
    candidate.action === "persist_replacement_offer"
  ) {
    return Reflect.ownKeys(candidate).length === 3 &&
      Reflect.ownKeys(candidate).every((key) => typeof key === "string");
  }
  return isDentalExecuteDecisionIdentity(value);
}
