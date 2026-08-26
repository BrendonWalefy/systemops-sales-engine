import type { EditorialConfig } from "@/application/config/editorial-config";
import type {
  LiveTurnContext,
  LiveTurnSnapshot,
} from "@/application/conversation/live-turn-lifecycle";
import type { V2LiveTurnConfiguration } from "@/application/conversation-v2/v2-live-conversation-handler";
import type { ConversationHandleInput } from "@/application/ports/conversation-handler";
import type { SpeakerProfile } from "@/conversation-core/composer/verbalization";
import { SCHEDULING_MINIMUM_LEAD_TIME_HOURS } from "@/core/scheduling/scheduling-policy";
import type { VoiceConfig } from "@/lib/tts-send";

export type V2LiveTurnConfigurationInput = Readonly<{
  context: LiveTurnContext;
  snapshot?: LiveTurnSnapshot;
  turnInput: ConversationHandleInput;
  now: Date;
}>;

export type V2LiveTurnConfigurationDependencies = Readonly<{
  resolveVoice(clinicId: string): Promise<VoiceConfig>;
  resumeExpiredTakeover(conversationId: string): Promise<void>;
}>;

export class V2TurnTenantScopeError extends Error {
  readonly code = "v2_turn_tenant_scope_mismatch";

  constructor() {
    super("V2 turn tenant scope mismatch");
    this.name = "V2TurnTenantScopeError";
  }
}

function toneFromEditorial(toneOfVoice: string | null | undefined): "neutral" | "warm" {
  return toneOfVoice?.trim() ? "warm" : "neutral";
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

const CONTENT_SECTION_HEADING = /^(?:PROCEDIMENTOS OFERECIDOS|DIFERENCIAIS|GARANTIA|COMO LIDAR COM OBJEÇÕES|PREÇOS?)\b/;
const MAX_GUIDELINES = 12;

function speakerFromEditorial(
  organizationName: string | null | undefined,
  editorial: EditorialConfig | null,
): SpeakerProfile {
  const guidelines = (editorial?.playbookText ?? "")
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter((section) => section.length > 0 && !CONTENT_SECTION_HEADING.test(section))
    .slice(0, MAX_GUIDELINES);

  return Object.freeze({
    agentName: trimmedOrNull(editorial?.receptionistName),
    organizationName: trimmedOrNull(organizationName),
    specialty: trimmedOrNull(editorial?.specialty),
    toneOfVoice: trimmedOrNull(editorial?.toneOfVoice),
    guidelines: Object.freeze(guidelines),
  });
}

export async function resolveV2LiveTurnConfiguration(
  input: V2LiveTurnConfigurationInput,
  deps: V2LiveTurnConfigurationDependencies,
): Promise<V2LiveTurnConfiguration> {
  if (
    input.context.clinicId !== input.turnInput.clinicId
    || input.context.clinic.id !== input.context.clinicId
    || input.context.conversation.clinicId !== input.context.clinicId
    || input.context.lead.clinicId !== input.context.clinicId
  ) {
    throw new V2TurnTenantScopeError();
  }

  let humanControlled = input.context.conversation.aiPaused;
  const expiresAt = input.context.conversation.takeoverExpiresAt;
  if (humanControlled && expiresAt && expiresAt < input.now) {
    await deps.resumeExpiredTakeover(input.context.conversationId);
    humanControlled = false;
  }
  const voice = await deps.resolveVoice(input.context.clinicId);

  return Object.freeze({
    gateInput: Object.freeze({
      automationEnabled: input.turnInput.replyEnabled !== false
        && input.turnInput.automationMode === "live",
      duplicate: false,
      humanControlled,
      optedOut: false,
    }),
    policy: Object.freeze({
      priceDisclosureEnabled: true,
      humanEscalationRequired: false,
      schedulingMinimumLeadTimeHours: SCHEDULING_MINIMUM_LEAD_TIME_HOURS,
      schedulingRequiresEvaluationFirst: false,
    }),
    speaker: speakerFromEditorial(input.context.clinic.name, input.context.editorial),
    style: Object.freeze({
      tone: toneFromEditorial(input.context.editorial?.toneOfVoice),
      verbosity: "concise",
      greeting: "omit",
      emoji: "none",
    }),
    useVoice: voice.voiceEnabled,
    ttsConfig: voice.ttsConfig,
  });
}
