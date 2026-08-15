import {
  RESPONSE_PLAN_VERSION,
  type AuthorizedResponsePlan,
  type AuthorizedService,
  type BuildResponsePlanInput,
} from "@/core/conversation/response-plan";

export function extractExplicitBrlCents(source: string | null): number[] {
  if (!source) return [];

  const values = [...source.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/gi)]
    .map((match) => Number(match[1]!.replace(/\./g, "")) * 100 + Number(match[2] ?? "0"));

  return normalizeNumbers(values);
}

export function buildAuthorizedResponsePlan(
  input: BuildResponsePlanInput,
): AuthorizedResponsePlan {
  const referencedPrice = input.actionResult.type === "price_inquiry"
    ? input.actionResult.referencedPriceCents
    : null;

  return {
    version: RESPONSE_PLAN_VERSION,
    action: input.actionResult.type,
    allowedPriceCents: normalizeNumbers([
      ...extractExplicitBrlCents(input.commercialPolicy),
      ...extractExplicitBrlCents(input.installmentTable),
      ...(typeof referencedPrice === "number" ? [referencedPrice] : []),
    ]),
    allowedScheduleFacts: normalizeStrings(extractScheduleFacts(input)),
    allowedMediaIds: normalizeStrings(input.allowedMediaIds),
    allowedServices: normalizeServices(input.authorizedServices ?? []),
    maxQuestions: 1,
    maxCharacters: input.maxCharacters,
    expectedState: input.expectedState ?? "none",
  };
}

function extractScheduleFacts(input: BuildResponsePlanInput): string[] {
  switch (input.actionResult.type) {
    case "slots_found":
      return input.actionResult.slots.map((slot) => slot.label);
    case "appointment_confirmed":
      return [input.actionResult.slot.label];
    case "appointment_rescheduled":
    case "slot_taken_reoffered":
      return input.actionResult.newSlots.map((slot) => slot.label);
    case "no_slots_available":
      return input.actionResult.alternativeSlots?.map((slot) => slot.label) ?? [];
    case "appointments_listed":
      return input.actionResult.appointments.map((appointment) => appointment.label);
    case "slots_expired":
      return input.actionResult.freshSlots.map((slot) => slot.label);
    case "evaluation_redirect":
      return input.actionResult.evaluationSlots.map((slot) => slot.label);
    case "appointment_reminder":
    case "appointment_reminder_with_confirmation":
    case "appointment_confirmation_accepted":
      return [input.actionResult.appointmentLabel];
    default:
      return [];
  }
}

function normalizeNumbers(values: readonly number[]): number[] {
  return [...new Set(values.filter(Number.isFinite))].sort((left, right) => left - right);
}

/** Ordem estável por nome, para o plano ser comparável entre execuções (replay). */
function normalizeServices(services: readonly AuthorizedService[]): AuthorizedService[] {
  return [...services]
    .filter((service) => service.name.trim().length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
