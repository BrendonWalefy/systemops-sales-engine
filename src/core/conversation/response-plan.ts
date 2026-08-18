import type { ActionResult } from "@/core/intelligence/ResponseComposer";

export const RESPONSE_PLAN_VERSION = "response-plan.v1" as const;

export type ResponsePlanViolationCode =
  | "empty_response"
  | "response_too_long"
  | "too_many_questions"
  | "unauthorized_media"
  | "unauthorized_price"
  | "unauthorized_schedule_fact"
  | "unsupported_guarantee"
  // O texto nomeia um serviço que o catálogo do tenant não tem.
  | "unauthorized_service"
  // O texto cola um preço autorizado num serviço que não é o dono dele.
  | "service_price_mismatch";

/**
 * Identidade de um serviço que o sistema autoriza a resposta a nomear.
 *
 * Antes disto o plano só carregava `allowedPriceCents`, uma lista solta de
 * números: o validador sabia que R$ 2.000 era um preço autorizado da clínica,
 * mas não de *qual* serviço — então uma resposta que colasse o preço das lentes
 * no clareamento passava calada. O vínculo preço↔serviço mora aqui.
 *
 * `aliases` vem do catálogo (`treatments.aliases`) e existe para o validador não
 * acusar a forma legítima que a clínica cadastrou.
 */
export type AuthorizedService = {
  name: string;
  aliases: readonly string[];
  /** Preço autorizado *deste* serviço, quando houver. */
  priceCents: number | null;
};

export type AuthorizedResponsePlan = {
  version: typeof RESPONSE_PLAN_VERSION;
  action: ActionResult["type"];
  allowedPriceCents: readonly number[];
  allowedScheduleFacts: readonly string[];
  allowedMediaIds: readonly string[];
  /**
   * Catálogo autorizado para este turno. Vazio = caminho que ainda não declara
   * serviços, e as duas checagens ficam inertes — zero regressão por omissão.
   */
  allowedServices: readonly AuthorizedService[];
  /**
   * `true` = a resposta só pode nomear serviços do catálogo, e o validador acusa
   * vocabulário do catálogo usado para montar um serviço inexistente.
   *
   * Ligado nos outbounds de propósito fixo (retomada de conversa), onde a
   * mensagem é curta e não há por que nomear nada fora da lista. Desligado na
   * conversa aberta, onde o composer discute procedimentos em prosa livre e um
   * falso positivo custa uma resposta boa a um lead real. Ligar lá depende da
   * medição de falso positivo contra o corpus — decisão do Ciclo C, não daqui.
   *
   * `service_price_mismatch` não depende deste campo: ele exige preço citado e
   * dono ausente, e vale em todo caminho que declare catálogo.
   */
  strictServiceVocabulary: boolean;
  maxQuestions: number;
  maxCharacters: number;
  expectedState: string;
};

export type BuildResponsePlanInput = {
  actionResult: ActionResult;
  commercialPolicy: string | null;
  installmentTable: string | null;
  allowedMediaIds: readonly string[];
  expectedState: string | null;
  maxCharacters: number;
  authorizedServices?: readonly AuthorizedService[];
  strictServiceVocabulary?: boolean;
};
