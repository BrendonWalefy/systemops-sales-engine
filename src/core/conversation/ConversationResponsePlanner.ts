import {
  buildAuthorizedResponsePlan,
} from "@/core/conversation/response-plan-builder";
import type {
  AuthorizedResponsePlan,
  BuildResponsePlanInput,
  ResponsePlanViolationCode,
} from "@/core/conversation/response-plan";
import { repairStyleViolations } from "@/core/conversation/repair-style-violations";
import { validateComposedResponse } from "@/core/conversation/response-validator";
import {
  buildSafeResponseFallback,
  type SafeResponseFallback,
} from "@/core/conversation/safe-response-fallback";
import {
  ResponseComposer,
  type ComposedResponse,
  type ComposerInput,
} from "@/core/intelligence/ResponseComposer";
import { isAtypicalClinicalCaseLabel } from "@/core/intelligence/objection-triage";

export type ResponseComposerPort = {
  compose(input: ComposerInput): Promise<ComposedResponse>;
};

export type PlannedResponse = {
  plan: AuthorizedResponsePlan;
  response: ComposedResponse;
  /**
   * `composer_repaired`: o texto é do composer, cortado para caber no plano
   * depois de reprovar só por estilo. Não é fallback — o conteúdo sobreviveu.
   */
  source: "composer" | "composer_repaired" | "deterministic_fallback";
  violations: readonly ResponsePlanViolationCode[];
  requiresHandoff: boolean;
  fallbackReason: SafeResponseFallback["reason"] | null;
  /**
   * Tempo de parede da chamada ao composer, em ms. `0` quando ele nem chegou a
   * ser chamado (curto-circuito determinístico), o que é informação: distingue
   * "o modelo demorou" de "o modelo não entrou na jogada".
   */
  composerLatencyMs: number;
};

function snapshotActionResult(
  actionResult: ComposerInput["actionResult"],
): ComposerInput["actionResult"] {
  return structuredClone(actionResult);
}

export class ConversationResponsePlanner {
  constructor(private readonly composer: ResponseComposerPort = new ResponseComposer()) {}

  async execute(input: {
    composerInput: ComposerInput;
    planInput: Omit<BuildResponsePlanInput, "actionResult">;
  }): Promise<PlannedResponse> {
    const actionResult = snapshotActionResult(input.composerInput.actionResult);
    const plan = buildAuthorizedResponsePlan({
      ...input.planInput,
      actionResult,
    });
    if (
      actionResult.type === "clinical_evaluation_required"
      && !isAtypicalClinicalCaseLabel(actionResult.reason)
    ) {
      const fallback = buildSafeResponseFallback({
        actionResult,
        plan,
        reason: "response_plan_violation",
      });
      return {
        plan,
        response: fallback.response,
        source: "deterministic_fallback",
        violations: [],
        requiresHandoff: fallback.requiresHandoff,
        fallbackReason: fallback.reason,
        composerLatencyMs: 0,
      };
    }

    let response: ComposedResponse;
    const composerStartedAt = Date.now();
    try {
      response = await this.composer.compose({
        ...input.composerInput,
        actionResult: snapshotActionResult(actionResult),
      });
    } catch {
      const fallback = buildSafeResponseFallback({
        actionResult,
        plan,
        reason: "composer_error",
      });
      return {
        plan,
        response: fallback.response,
        source: "deterministic_fallback",
        violations: [],
        requiresHandoff: fallback.requiresHandoff,
        fallbackReason: fallback.reason,
        composerLatencyMs: Date.now() - composerStartedAt,
      };
    }
    const composerLatencyMs = Date.now() - composerStartedAt;
    const validation = validateComposedResponse({ plan, response });

    if (!validation.ok) {
      // Violação de estilo não custa a resposta: corta e entrega, sem chamar
      // humano. Só falha de fato não autorizado desce para o fallback.
      const repaired = repairStyleViolations({
        response,
        plan,
        violations: validation.violations,
      });
      if (repaired) {
        return {
          plan,
          response: repaired,
          source: "composer_repaired",
          violations: validation.violations,
          requiresHandoff: false,
          fallbackReason: null,
          composerLatencyMs,
        };
      }

      const fallback = buildSafeResponseFallback({
        actionResult,
        plan,
        reason: "response_plan_violation",
      });
      return {
        plan,
        response: fallback.response,
        source: "deterministic_fallback",
        violations: validation.violations,
        requiresHandoff: fallback.requiresHandoff,
        fallbackReason: fallback.reason,
        composerLatencyMs,
      };
    }

    return {
      plan,
      response,
      source: "composer",
      violations: [],
      requiresHandoff: false,
      fallbackReason: null,
      composerLatencyMs,
    };
  }
}
