import type { V2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";

export type DraftSpeechAct =
  | {
      kind: "inform_fact";
      outcomeRef: string;
      factRef: string;
      subjectRef: string;
    }
  | {
      kind: "offer_options";
      outcomeRef: string;
      subjectRef: string | null;
      optionRefs: readonly string[];
    }
  | {
      kind: "confirm_effect";
      outcomeRef: string;
      subjectRef: string;
      factRefs: readonly string[];
    }
  | { kind: "communicate_failure"; outcomeRef: string }
  | { kind: "inform_required_action"; outcomeRef: string }
  | { kind: "ask_clarification"; outcomeRef: string };

export type DraftResponse = { acts: readonly DraftSpeechAct[] };
export type CoreResponse = { text: string; parts: readonly unknown[] };

export type ComposerStyle = {
  tone: "neutral" | "warm";
  verbosity: "concise" | "standard";
  greeting: "omit" | "include";
  emoji: "none" | "light";
};

export interface ResponseComposerPort<OutcomeType extends string> {
  compose(input: {
    plan: V2AuthorizedResponsePlan<OutcomeType>;
    style: ComposerStyle;
  }): Promise<unknown>;
}
