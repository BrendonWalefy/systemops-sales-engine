import type { AuthorizedResponsePlan } from "@/core/conversation/response-plan";
import { validateComposedResponse } from "@/core/conversation/response-validator";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import type {
  ActionResult,
  ComposedResponse,
} from "@/core/intelligence/ResponseComposer";

export type SafeResponseFallback = {
  response: ComposedResponse;
  requiresHandoff: boolean;
  reason: "composer_error" | "response_plan_violation";
};

type SafeResponseFallbackInput = {
  actionResult: ActionResult;
  plan: AuthorizedResponsePlan;
  reason: SafeResponseFallback["reason"];
};

const NEUTRAL_HANDOFF_COPY =
  "Quero te responder isso com precisão. Vou chamar nossa equipe para confirmar e continuar por aqui.";

export function buildSafeResponseFallback(
  input: SafeResponseFallbackInput,
): SafeResponseFallback {
  const text = buildFallbackText(input.actionResult, input.plan);
  const candidate = text === null ? null : deterministicResponse(text);

  if (candidate && validateComposedResponse({ plan: input.plan, response: candidate }).ok) {
    return {
      response: candidate,
      requiresHandoff: false,
      reason: input.reason,
    };
  }

  return {
    response: safeHandoffResponse(input.plan),
    requiresHandoff: true,
    reason: input.reason,
  };
}

function safeHandoffResponse(plan: AuthorizedResponsePlan): ComposedResponse {
  const neutralHandoff = deterministicResponse(NEUTRAL_HANDOFF_COPY);
  if (validateComposedResponse({ plan, response: neutralHandoff }).ok) {
    return neutralHandoff;
  }

  return deterministicResponse("!");
}

function buildFallbackText(
  actionResult: ActionResult,
  plan: AuthorizedResponsePlan,
): string | null {
  switch (actionResult.type) {
    case "quantity_price_confirmation_required":
      return quantityPriceConfirmationCopy(actionResult.quantity, actionResult.scope);
    case "clinical_evaluation_required":
      return `Entendi o que aconteceu com ${actionResult.reason}. Como esse caso precisa ser avaliado pelo Doutor, não vou confirmar técnica ou valor por mensagem. Já sinalizei a equipe para orientar o próximo passo e montar o orçamento correto.`;
    case "slots_found":
      return slotsCopy(actionResult.slots, plan);
    case "appointment_confirmed":
      return appointmentCopy("Seu horário está confirmado", [actionResult.slot.label], plan);
    case "appointment_rescheduled":
      return appointmentCopy("Seu agendamento foi atualizado", actionResult.newSlots.map((slot) => slot.label), plan);
    case "appointments_listed":
      return appointmentCopy("Seus agendamentos", actionResult.appointments.map((appointment) => appointment.label), plan);
    case "slot_taken_reoffered":
      return slotsCopy(actionResult.newSlots, plan);
    case "slots_expired":
      return slotsCopy(actionResult.freshSlots, plan);
    case "evaluation_redirect":
      return slotsCopy(actionResult.evaluationSlots, plan);
    case "no_slots_available":
      return actionResult.alternativeSlots
        ? slotsCopy(actionResult.alternativeSlots, plan)
        : "No momento, não tenho horários disponíveis para oferecer.";
    case "appointment_reminder":
    case "appointment_reminder_with_confirmation":
    case "appointment_confirmation_accepted":
      return appointmentCopy("Lembrete do seu agendamento", [actionResult.appointmentLabel], plan);
    case "appointment_cancelled":
      return "Seu agendamento foi cancelado.";
    case "no_appointments":
      return "Não há agendamentos registrados no momento.";
    case "appointment_confirmation_rejected":
      return "Entendi. Vou deixar esse agendamento como não confirmado.";
    default:
      return null;
  }
}

function slotsCopy(slots: readonly FormattedSlot[], plan: AuthorizedResponsePlan): string | null {
  const labels = authorizedLabels(slots.map((slot) => slot.label), plan);
  return labels.length > 0 ? `Horários disponíveis:\n${labels.map((label) => `- ${label}`).join("\n")}` : null;
}

function appointmentCopy(
  prefix: string,
  labels: readonly string[],
  plan: AuthorizedResponsePlan,
): string | null {
  const authorized = authorizedLabels(labels, plan);
  if (authorized.length === 0) return null;
  return `${prefix}:\n${authorized.map((label) => `- ${label}`).join("\n")}`;
}

function authorizedLabels(labels: readonly string[], plan: AuthorizedResponsePlan): string[] {
  const allowed = new Set(plan.allowedScheduleFacts);
  return labels.filter((label) => allowed.has(label));
}

function quantityPriceConfirmationCopy(
  quantity: number,
  scope: "total" | "superior" | "inferior",
): string {
  const scopeLabel = scope === "superior"
    ? "dentes superiores"
    : scope === "inferior"
      ? "dentes inferiores"
      : "unidades";
  return `Entendi que você quer harmonizar ${quantity} ${scopeLabel}. Como essa combinação não está cadastrada como pacote fechado, não vou te passar um valor aproximado. Já sinalizei a equipe para confirmar o valor exato e orientar a avaliação.`;
}

function deterministicResponse(text: string): ComposedResponse {
  return {
    parts: [{ type: "text", content: text }],
    text,
    mediaIds: [],
    model: "deterministic-fallback",
    promptVersion: "response-fallback.v1",
    inputTokens: 0,
    outputTokens: 0,
  };
}
