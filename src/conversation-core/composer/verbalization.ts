import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import type { AuthorizedSurface } from "@/conversation-core/composer/verbalization-validator";
import type { ComposerStyle } from "@/conversation-core/composer/contract";
import type { ValidatedDraftResponse } from "@/conversation-core/composer/validator";

/**
 * Quem fala, em nome de quem, com que voz e sob quais orientacoes editoriais.
 * O core nao sabe de onde isso vem: quem monta o turno resolve o dono de cada
 * campo e entrega pronto.
 */
export type SpeakerProfile = Readonly<{
  agentName: string | null;
  organizationName: string | null;
  specialty: string | null;
  toneOfVoice: string | null;
  guidelines: readonly string[];
}>;

export type VerbalizationRequest<OutcomeType extends string> = Readonly<{
  plan: V2AuthorizedResponsePlan<OutcomeType>;
  draft: ValidatedDraftResponse<OutcomeType>;
  surface: AuthorizedSurface;
  /** O mesmo conteudo, ja autorizado, na forma mais crua possivel. */
  authorizedText: string;
  style: ComposerStyle;
  speaker: SpeakerProfile;
}>;

export interface ResponseVerbalizerPort<OutcomeType extends string> {
  readonly modelId: string;
  verbalize(request: VerbalizationRequest<OutcomeType>): Promise<unknown>;
}

export type VerbalizationOutcome =
  | { status: "absent" }
  | { status: "accepted"; modelId: string; latencyMs: number }
  | {
      status: "rejected";
      modelId: string;
      latencyMs: number;
      violations: readonly string[];
    }
  | { status: "failed"; modelId: string; latencyMs: number };
