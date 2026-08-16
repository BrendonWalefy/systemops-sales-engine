import { createHmac } from "node:crypto";
import type { Decision } from "@/conversation-core/decision";

export type IntendedEffect = Readonly<{ kind: "would_have_executed"; capabilityId: string; payloadHash: string }> & (
  | Readonly<{ action: "book_slot"; payload: Readonly<{ slotRefHash: string }> }>
  | Readonly<{ action: "confirm_appointment"; payload: Readonly<{ appointmentRefHash: string }> }>
);

function hmac(hmacKey: string, value: string): string {
  return createHmac("sha256", hmacKey).update(value).digest("hex");
}

export function recordDentalIntendedEffect(input: {
  capabilityId: string;
  decision: Decision;
  hmacKey: string;
}): IntendedEffect | null {
  if (input.decision.kind !== "execute") return null;
  const { action } = input.decision;
  if (action.type === "book-slot") {
    const slotId = action.parameters.slotId;
    if (typeof slotId !== "string") return null;
    const slotRefHash = hmac(input.hmacKey, `dental-shadow:slot:${slotId}`);
    return { kind: "would_have_executed", capabilityId: input.capabilityId, action: "book_slot", payload: { slotRefHash }, payloadHash: hmac(input.hmacKey, `dental-shadow:book_slot:${slotRefHash}`) };
  }
  if (action.type === "confirm-appointment") {
    const appointmentId = action.parameters.appointmentId;
    if (typeof appointmentId !== "string") return null;
    const appointmentRefHash = hmac(input.hmacKey, `dental-shadow:appointment:${appointmentId}`);
    return { kind: "would_have_executed", capabilityId: input.capabilityId, action: "confirm_appointment", payload: { appointmentRefHash }, payloadHash: hmac(input.hmacKey, `dental-shadow:confirm_appointment:${appointmentRefHash}`) };
  }
  return null;
}
