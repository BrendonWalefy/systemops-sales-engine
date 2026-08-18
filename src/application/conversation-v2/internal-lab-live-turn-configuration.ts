import type { LiveTurnContext, LiveTurnSnapshot } from "@/application/conversation/live-turn-lifecycle";
import type { V2LiveTurnConfiguration } from "@/application/conversation-v2/v2-live-conversation-handler";
import type { ConversationHandleInput } from "@/application/ports/conversation-handler";
import { SCHEDULING_MINIMUM_LEAD_TIME_HOURS } from "@/core/scheduling/scheduling-policy";
import type { VoiceConfig } from "@/lib/tts-send";
import {
  INTERNAL_LAB_DELIVERY_BINDING_SCHEMA,
  type InternalLabDeliveryBinding,
} from "@/application/conversation-v2/internal-lab-delivery-guard";

export type InternalLabLiveTurnConfigurationInput = Readonly<{
  context: LiveTurnContext;
  snapshot?: LiveTurnSnapshot;
  turnInput: ConversationHandleInput;
  now: Date;
}>;

export type InternalLabLiveTurnConfigurationDependencies = Readonly<{
  resolveVoice(clinicId: string): Promise<VoiceConfig>;
  resumeExpiredTakeover(conversationId: string): Promise<void>;
  resolveDeliveryBinding(clinicId: string): Promise<Omit<InternalLabDeliveryBinding, "schemaVersion">>;
}>;

function toneFromEditorial(toneOfVoice: string | null | undefined): "neutral" | "warm" {
  return toneOfVoice?.trim() ? "warm" : "neutral";
}

export async function resolveInternalLabLiveTurnConfiguration(
  input: InternalLabLiveTurnConfigurationInput,
  deps: InternalLabLiveTurnConfigurationDependencies,
): Promise<V2LiveTurnConfiguration> {
  let humanControlled = input.context.conversation.aiPaused;
  const expiresAt = input.context.conversation.takeoverExpiresAt;
  if (humanControlled && expiresAt && expiresAt < input.now) {
    await deps.resumeExpiredTakeover(input.context.conversationId);
    humanControlled = false;
  }
  const [voice, bindings] = await Promise.all([
    deps.resolveVoice(input.context.clinicId),
    deps.resolveDeliveryBinding(input.context.clinicId),
  ]);
  return Object.freeze({
    gateInput: Object.freeze({
      automationEnabled: input.turnInput.replyEnabled !== false
        && input.turnInput.automationMode === "live",
      duplicate: false,
      humanControlled,
      // V1 allows future user-initiated inbound after opt-out; durable consent
      // continues to gate proactive automation in the existing sender policy.
      optedOut: false,
    }),
    policy: Object.freeze({
      priceDisclosureEnabled: true,
      humanEscalationRequired: false,
      schedulingMinimumLeadTimeHours: SCHEDULING_MINIMUM_LEAD_TIME_HOURS,
      // Exact treatment ownership is enforced by the dental scheduling read.
      schedulingRequiresEvaluationFirst: false,
    }),
    style: Object.freeze({
      tone: toneFromEditorial(input.context.editorial?.toneOfVoice),
      verbosity: "concise",
      greeting: "omit",
      emoji: "none",
    }),
    useVoice: voice.voiceEnabled,
    ttsConfig: voice.ttsConfig,
    deliveryBinding: Object.freeze({
      schemaVersion: INTERNAL_LAB_DELIVERY_BINDING_SCHEMA,
      ...bindings,
    }),
  });
}
