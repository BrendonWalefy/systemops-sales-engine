import { createResponseLanguageContribution } from "@/conversation-core/composer/language";

export const DENTAL_RESPONSE_LANGUAGE = createResponseLanguageContribution({
  locale: "pt-BR",
  factTerms: [
    { factKey: "service_available", label: "Disponibilidade", format: "boolean" },
    { factKey: "price_cents", label: "Valor", format: "currency_minor_brl" },
    { factKey: "slot_label", label: "Horário", format: "text" },
    { factKey: "appointment_label", label: "Horário", format: "text" },
  ],
  outcomeTerms: [
    { outcomeType: "catalog_answered", label: "informação", gender: "feminine" },
    { outcomeType: "slots_found", label: "horários", gender: "masculine" },
    { outcomeType: "appointment_created", label: "agendamento", gender: "masculine" },
    { outcomeType: "appointment_confirmed", label: "confirmação do agendamento", gender: "feminine" },
    { outcomeType: "appointment_create_failed", label: "agendamento", gender: "masculine" },
    { outcomeType: "appointment_confirmation_failed", label: "confirmação do agendamento", gender: "feminine" },
    { outcomeType: "scheduling_failed", label: "agendamento", gender: "masculine" },
    { outcomeType: "escalation_required", label: "atendimento humano", gender: "masculine" },
    { outcomeType: "clarification_required", label: "os dados", gender: "masculine" },
  ],
  subjectTerms: [
    { subjectType: "service", label: "serviço" },
    { subjectType: "slot", label: "horário" },
    { subjectType: "appointment", label: "agendamento" },
  ],
});
