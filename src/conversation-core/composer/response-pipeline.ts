import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type {
  ComposerStyle,
  CoreResponse,
  ResponseComposerPort,
} from "@/conversation-core/composer/contract";
import { buildSafeFallback } from "@/conversation-core/composer/fallback";
import { repairDraft } from "@/conversation-core/composer/repair";
import {
  validateDraft,
  type DraftViolation,
  type ValidatedDraftResponse,
} from "@/conversation-core/composer/validator";

export type V2ResponsePipelineResult =
  | {
      status: "rendered";
      source: "draft" | "repair" | "fallback";
      response: CoreResponse;
    }
  | {
      status: "no_safe_response";
      violations: readonly DraftViolation[];
    };

export async function runV2ResponsePipeline(input: {
  plan: V2AuthorizedResponsePlan;
  style: ComposerStyle;
  composer: ResponseComposerPort;
  render(draft: ValidatedDraftResponse): CoreResponse;
}): Promise<V2ResponsePipelineResult> {
  let violations: readonly DraftViolation[] = [];

  try {
    const draft = await input.composer.compose({
      plan: input.plan,
      style: input.style,
    });
    const original = validateDraft(input.plan, draft);
    if (original.valid) {
      return {
        status: "rendered",
        source: "draft",
        response: input.render(original.draft),
      };
    }
    violations = original.violations;

    const repaired = repairDraft(input.plan, draft);
    if (repaired.acts.length > 0) {
      const repairedResult = validateDraft(input.plan, repaired);
      if (repairedResult.valid) {
        return {
          status: "rendered",
          source: "repair",
          response: input.render(repairedResult.draft),
        };
      }
      violations = repairedResult.violations;
    }
  } catch {
    // Composer failure carries no authority. Continue with the same-plan fallback.
  }

  const fallback = buildSafeFallback(input.plan);
  if (fallback) {
    return {
      status: "rendered",
      source: "fallback",
      response: input.render(fallback),
    };
  }

  return { status: "no_safe_response", violations };
}
