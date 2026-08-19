import {
  snapshotV2AuthorizedResponsePlan,
  type V2AuthorizedResponsePlan,
} from "@/conversation-core/authorized-response-plan";
import {
  authorizedStatementsFor,
  authorizedSurfaceFor,
} from "@/conversation-core/composer/authorized-surface";
import { validateVerbalizedText } from "@/conversation-core/composer/verbalization-validator";
import type {
  ResponseVerbalizerPort,
  SpeakerProfile,
  VerbalizationOutcome,
} from "@/conversation-core/composer/verbalization";
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

/** Prazo do turno para a verbalizacao. Estourou, a resposta autorizada sai. */
export const DEFAULT_VERBALIZATION_TIMEOUT_MS = 6_000;

export type V2ResponsePipelineResult =
  | {
      status: "rendered";
      source: "draft" | "repair" | "fallback";
      verbalization: VerbalizationOutcome;
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
  verbalization?: {
    verbalizer: ResponseVerbalizerPort;
    speaker: SpeakerProfile;
    timeoutMs?: number;
  };
}): Promise<V2ResponsePipelineResult> {
  const plan = snapshotV2AuthorizedResponsePlan(input.plan);
  const style = Object.freeze({ ...input.style });
  let violations: readonly DraftViolation[] = [];

  const render = async (
    draft: ValidatedDraftResponse<OutcomeType>,
    source: "draft" | "repair" | "fallback",
  ): Promise<V2ResponsePipelineResult> => {
    let authorized: CoreResponse;
    try {
      authorized = renderDeterministicResponse({ draft });
    } catch {
      return { status: "no_safe_response", reason: "render_failed", violations };
    }
    const spoken = await verbalize(draft);
    return {
      status: "rendered",
      source,
      verbalization: spoken.outcome,
      response: spoken.text === null
        ? authorized
        : Object.freeze({ text: spoken.text, parts: authorized.parts }),
    };
  };

  /**
   * O texto autorizado ja e uma resposta segura. O modelo so pode reescreve-lo:
   * se a reescrita nao couber no plano, ela e descartada e a versao crua vai
   * embora assim mesmo. Nunca silencio.
   */
  const verbalize = async (
    draft: ValidatedDraftResponse<OutcomeType>,
  ): Promise<{ outcome: VerbalizationOutcome; text: string | null }> => {
    const requested = input.verbalization;
    if (!requested) return { outcome: { status: "absent" }, text: null };
    const modelId = requested.verbalizer.modelId;
    const startedAt = performance.now();
    const elapsed = () => Math.max(0, Math.round(performance.now() - startedAt));
    const surface = authorizedSurfaceFor(draft);
    const controller = new AbortController();
    const deadline = requested.timeoutMs ?? DEFAULT_VERBALIZATION_TIMEOUT_MS;
    let expired: ReturnType<typeof setTimeout> | undefined;
    let candidate: unknown;
    try {
      // A corrida garante o prazo mesmo que a porta ignore o sinal: o turno tem
      // orcamento de tempo, e uma chamada pendurada viraria silencio.
      candidate = await Promise.race([
        requested.verbalizer.verbalize(Object.freeze({
          statements: authorizedStatementsFor(draft),
          surface,
          style,
          speaker: requested.speaker,
        }), { signal: controller.signal }),
        new Promise<never>((_resolve, reject) => {
          expired = setTimeout(() => {
            controller.abort(new Error("verbalization_timeout"));
            reject(new Error("verbalization_timeout"));
          }, deadline);
        }),
      ]);
    } catch {
      return { outcome: { status: "failed", modelId, latencyMs: elapsed() }, text: null };
    } finally {
      if (expired !== undefined) clearTimeout(expired);
    }
    const checked = validateVerbalizedText({ text: candidate, surface });
    if (!checked.valid) {
      return {
        outcome: {
          status: "rejected",
          modelId,
          latencyMs: elapsed(),
          violations: checked.violations,
        },
        text: null,
      };
    }
    return { outcome: { status: "accepted", modelId, latencyMs: elapsed() }, text: checked.text };
  };

  try {
    const draft = await input.composer.compose({
      plan,
      style,
    });
    const original = validateDraft(plan, draft);
    if (original.valid) {
      return await render(original.draft, "draft");
    }
    violations = original.violations;

    const repaired = original.draft
      ? repairDraft(plan, original.draft)
      : { acts: [] };
    if (repaired.acts.length > 0) {
      const repairedResult = validateDraft(plan, repaired);
      if (repairedResult.valid) {
        return await render(repairedResult.draft, "repair");
      }
      violations = repairedResult.violations;
    }
  } catch {
    // Composer failure carries no authority. Continue with the same-plan fallback.
  }

  const fallback = buildSafeFallback(plan);
  if (fallback) {
    try {
      return await render(fallback, "fallback");
    } catch {
      return { status: "no_safe_response", reason: "render_failed", violations };
    }
  }

  return { status: "no_safe_response", reason: "no_valid_draft", violations };
}
