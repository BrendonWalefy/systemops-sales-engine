import type { ActionResult } from "@/core/intelligence/ResponseComposer";

export const RESPONSE_PLAN_VERSION = "response-plan.v1" as const;

export type ResponsePlanViolationCode =
  | "empty_response"
  | "response_too_long"
  | "too_many_questions"
  | "unauthorized_media"
  | "unauthorized_price"
  | "unauthorized_schedule_fact"
  | "unsupported_guarantee";

export type AuthorizedResponsePlan = {
  version: typeof RESPONSE_PLAN_VERSION;
  action: ActionResult["type"];
  allowedPriceCents: readonly number[];
  allowedScheduleFacts: readonly string[];
  allowedMediaIds: readonly string[];
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
};
