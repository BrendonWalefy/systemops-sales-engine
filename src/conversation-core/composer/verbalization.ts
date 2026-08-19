import type { AuthorizedSurface } from "@/conversation-core/composer/verbalization-validator";
import type { ComposerStyle } from "@/conversation-core/composer/contract";

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

/**
 * O sentido de cada ato autorizado, separado da frase crua que o representa.
 * Sem isto o modelo so tem uma frase de maquina para imitar.
 */
export type AuthorizedStatement = Readonly<{
  meaning:
    | "inform_fact"
    | "offer_options"
    | "confirm_effect"
    | "communicate_failure"
    | "inform_required_action"
    | "invite_engagement"
    | "ask_clarification";
  subject: string | null;
  values: readonly string[];
}>;

/**
 * Tudo que o verbalizador recebe, e nada alem disso. O plano completo carrega
 * fato interno e referencia de evidencia: entregar o plano inteiro a uma porta
 * externa seria dar acesso ao que a decisao usou, e nao ao que pode ser dito.
 */
export type VerbalizationRequest = Readonly<{
  statements: readonly AuthorizedStatement[];
  surface: AuthorizedSurface;
  style: ComposerStyle;
  speaker: SpeakerProfile;
}>;

export interface ResponseVerbalizerPort {
  readonly modelId: string;
  verbalize(
    request: VerbalizationRequest,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<unknown>;
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
