import {
  snapshotV2AuthorizedResponsePlan,
  type V2AuthorizedResponsePlan,
} from "@/conversation-core/authorized-response-plan";
import type {
  ComposerStyle,
  CoreResponse,
  ResponseComposerPort,
} from "@/conversation-core/composer/contract";
import { buildSafeFallback } from "@/conversation-core/composer/fallback";
import { renderDeterministicResponse } from "@/conversation-core/composer/deterministic-renderer";
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
      reason: "no_valid_draft" | "render_failed";
      violations: readonly DraftViolation[];
    };

export async function runV2ResponsePipeline<OutcomeType extends string>(input: {
  plan: V2AuthorizedResponsePlan<OutcomeType>;
  style: ComposerStyle;
  composer: ResponseComposerPort<OutcomeType>;
}): Promise<V2ResponsePipelineResult> {
  const plan = snapshotV2AuthorizedResponsePlan(input.plan);
  const style = Object.freeze({ ...input.style });
  let violations: readonly DraftViolation[] = [];

  const render = (
    draft: ValidatedDraftResponse<OutcomeType>,
    source: "draft" | "repair" | "fallback",
  ): V2ResponsePipelineResult => {
    try {
      return {
        status: "rendered",
        source,
        response: renderDeterministicResponse({
          draft,
        }),
      };
    } catch {
      return { status: "no_safe_response", reason: "render_failed", violations };
    }
  };

  try {
    const draft = await input.composer.compose({
      plan,
      style,
    });
    const original = validateDraft(plan, draft);
    if (original.valid) {
      return render(original.draft, "draft");
    }
    violations = original.violations;

    const repaired = original.draft
      ? repairDraft(plan, original.draft)
      : { acts: [] };
    if (repaired.acts.length > 0) {
      const repairedResult = validateDraft(plan, repaired);
      if (repairedResult.valid) {
        return render(repairedResult.draft, "repair");
      }
      violations = repairedResult.violations;
    }
  } catch {
    // Composer failure carries no authority. Continue with the same-plan fallback.
  }

  const fallback = buildSafeFallback(plan);
  if (fallback) {
    return render(fallback, "fallback");
  }

  return { status: "no_safe_response", reason: "no_valid_draft", violations };
}
