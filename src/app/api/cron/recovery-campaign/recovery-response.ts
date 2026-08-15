import type { BuildResponsePlanInput } from "@/core/conversation/response-plan";
import type { ComposerInput } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

/** Três frases curtas, como o prompt da campanha já pedia. */
export const RECOVERY_MAX_CHARACTERS = 600;

/**
 * A fronteira da campanha de recuperação.
 *
 * Este é o caminho mais exposto do sistema: cron agendado duas vezes por dia no
 * `vercel.json`, sem nenhum humano entre a geração e o WhatsApp do lead. O
 * gerador tem prompt próprio, cujas regras — "não prometa agendamento", "não
 * liste horários", "não invente nomes de procedimento" — viviam só em prosa.
 *
 * Prosa é pedido, não garantia. O plano transforma as mesmas regras em fatos
 * autorizados que o validador verifica depois: sem preço (nenhuma política
 * comercial entra), sem fato de agenda (`conversation_recovery` não deriva
 * nenhum) e sem mídia.
 */
export function buildRecoveryComposerInput(input: {
  treatmentNames: string[];
  clinic: ComposerInput["clinic"];
  leadName: string | null;
  timezone: string;
}): ComposerInput {
  return {
    actionResult: {
      type: "conversation_recovery",
      treatmentNames: input.treatmentNames,
    },
    conversationHistory: [],
    clinic: input.clinic,
    leadName: input.leadName,
    timezone: new ClinicTimezone(input.timezone),
    isFirstMessage: false,
  };
}

export function buildRecoveryPlanInput(input: {
  maxCharacters: number;
}): Omit<BuildResponsePlanInput, "actionResult"> {
  return {
    commercialPolicy: null,
    installmentTable: null,
    allowedMediaIds: [],
    expectedState: null,
    maxCharacters: input.maxCharacters,
  };
}
