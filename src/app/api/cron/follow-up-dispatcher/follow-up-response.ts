import type { BuildResponsePlanInput } from "@/core/conversation/response-plan";

/**
 * Mesmo default de `resolveResponseMaxCharacters` sem verbosity definida. O cron
 * não lê o módulo concierge da clínica pela mesma razão do lembrete: verbosity é
 * preferência de conversa, e o follow-up é uma mensagem curta iniciada pelo
 * sistema. Ver `appointment-reminder/reminder-response.ts`.
 */
export const FOLLOW_UP_MAX_CHARACTERS = 600;

/**
 * A fronteira do follow-up, extraída da rota para ser testável sem subir o cron.
 *
 * Reengajar não é negociar: o follow-up não tem preço autorizado, não tem mídia
 * autorizada e não carrega política comercial. O único fato que pode afirmar é o
 * que o próprio `actionResult` traz — o rótulo da consulta anterior, no caso de
 * `reengagement`, ou o título do vídeo, no de `video_sent_followup` — e isso
 * `buildAuthorizedResponsePlan` deriva sozinho.
 */
export function buildFollowUpPlanInput(input: {
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
