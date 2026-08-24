import type { EditorialConfig } from "@/application/config/editorial-config";
import type { LiveTurnContext, LiveTurnSnapshot } from "@/application/conversation/live-turn-lifecycle";
import type { SpeakerProfile } from "@/conversation-core/composer/verbalization";
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

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Seções do playbook cuja primeira linha declara conteúdo, não maneira. Elas
 * afirmam procedimento, diferencial, garantia e condição comercial — fatos que
 * só podem chegar ao lead por uma capability, dentro do plano autorizado.
 */
const CONTENT_SECTION_HEADING = /^(?:PROCEDIMENTOS OFERECIDOS|DIFERENCIAIS|GARANTIA|COMO LIDAR COM OBJEÇÕES|PREÇOS?)\b/;
const MAX_GUIDELINES = 12;

/**
 * A voz da empresa dentro da resposta. Cada campo continua com o dono declarado
 * em AGENTS.md: conteúdo editorial vem da versão ativa do playbook, o nome de
 * apresentação vem do tenant. Nada é redigitado aqui, e ausência vira ausência
 * — nunca um valor inventado para preencher a lacuna.
 *
 * O que atravessa é maneira de falar. Preço, diferencial, garantia e resposta a
 * objeção ficam de fora de propósito: o verbalizador não pode afirmar fato, e
 * dar-lhe um preço em prosa é convidá-lo a afirmar. Esses dados chegam ao lead
 * como fato autorizado, decidido por uma capability.
 */
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
    speaker: speakerFromEditorial(input.context.clinic.name, input.context.editorial),
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
