import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type {
  ComposerStyle,
  CoreResponse,
  ResponseComposerPort,
} from "@/conversation-core/composer/contract";
import { buildSafeFallback } from "@/conversation-core/composer/fallback";
import { renderDeterministicResponse } from "@/conversation-core/composer/deterministic-renderer";
import type { ValidatedResponseLanguageContribution } from "@/conversation-core/composer/language";
import { repairDraft } from "@/conversation-core/composer/repair";
import {
  validateDraft,
  type DraftViolation,
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

export async function runV2ResponsePipeline(input: {
  plan: V2AuthorizedResponsePlan;
  style: ComposerStyle;
  composer: ResponseComposerPort;
  language: ValidatedResponseLanguageContribution;
}): Promise<V2ResponsePipelineResult> {
  let violations: readonly DraftViolation[] = [];

  const render = (
    draft: Parameters<typeof renderDeterministicResponse>[0]["draft"],
    source: "draft" | "repair" | "fallback",
  ): V2ResponsePipelineResult => {
    try {
      return {
        status: "rendered",
        source,
        response: renderDeterministicResponse({
          draft,
          language: input.language,
          style: input.style,
        }),
      };
    } catch {
      return { status: "no_safe_response", reason: "render_failed", violations };
    }
  };

  try {
    const draft = await input.composer.compose({
      plan: input.plan,
      style: input.style,
    });
    const original = validateDraft(input.plan, draft);
    if (original.valid) {
      return render(original.draft, "draft");
    }
    violations = original.violations;

    const repaired = repairDraft(input.plan, draft);
    if (repaired.acts.length > 0) {
      const repairedResult = validateDraft(input.plan, repaired);
      if (repairedResult.valid) {
        return render(repairedResult.draft, "repair");
      }
      violations = repairedResult.violations;
    }
  } catch {
    // Composer failure carries no authority. Continue with the same-plan fallback.
  }

  const fallback = buildSafeFallback(input.plan);
  if (fallback) {
    return render(fallback, "fallback");
  }

  return { status: "no_safe_response", reason: "no_valid_draft", violations };
}
