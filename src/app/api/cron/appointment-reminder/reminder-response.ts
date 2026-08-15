import type { BuildResponsePlanInput } from "@/core/conversation/response-plan";
import type { ComposerInput } from "@/core/intelligence/ResponseComposer";
import { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

/**
 * A fronteira do lembrete, extraída da rota para ser testável sem subir o cron.
 *
 * O lembrete é o único texto de LLM que o lead recebe sem ter perguntado nada, e
 * era o único que chegava até ele sem passar por plano + validador: a rota
 * chamava `composer.compose` e mandava o texto direto para a outbox. Um composer
 * que trocasse o horário produziria uma confirmação de um horário inexistente —
 * e o erro só apareceria na cadeira vazia.
 */
export function buildReminderComposerInput(input: {
  appointmentLabel: string;
  clinic: ComposerInput["clinic"];
  leadName: string | null;
  timezone: string;
}): ComposerInput {
  return {
    actionResult: {
      type: "appointment_reminder_with_confirmation",
      appointmentLabel: input.appointmentLabel,
    },
    conversationHistory: [],
    clinic: input.clinic,
    leadName: input.leadName,
    timezone: new ClinicTimezone(input.timezone),
    isFirstMessage: false,
  };
}

/**
 * Mesmo valor que `resolveResponseMaxCharacters` devolve sem verbosity definida.
 * O cron não lê o módulo concierge da clínica: verbosity é preferência de
 * *conversa*, e o lembrete é uma mensagem fixa, curta e iniciada pelo sistema —
 * ler a config por clínica aqui custaria uma query por lembrete para escolher
 * entre limites que nenhum lembrete alcança. Duplicar a constante é deliberado;
 * importar do ConversationOrchestrator arrastaria o pipeline inteiro para o cron.
 */
export const REMINDER_MAX_CHARACTERS = 600;

/**
 * O lembrete não negocia nem oferece nada: sem política comercial, sem tabela de
 * parcelamento, sem mídia. O único fato autorizado é o horário da consulta, que
 * `buildAuthorizedResponsePlan` deriva do próprio `actionResult`.
 */
export function buildReminderPlanInput(input: {
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
