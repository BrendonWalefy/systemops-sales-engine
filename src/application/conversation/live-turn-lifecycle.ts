import type { ConversationHandleInput } from "@/application/ports/conversation-handler";
import type { LiveConversationContextReader } from "@/application/ports/live-conversation-context-reader";
import type { RegisterIncomingMessage } from "@/application/use-cases/leads/register-incoming-message";
import type {
  ConversationStateMachine,
  ConversationStateRow,
} from "@/core/conversation/ConversationStateMachine";
import type { ConversationTurnCoordinator } from "@/core/pipeline/ConversationTurnCoordinator";
import {
  buildContactIdentifiersFromWebhook,
  resolveWhatsAppChannelAddress,
} from "@/core/whatsapp/WhatsAppContactIdentity";
import type { Conversation, Message } from "@/domain/entities/conversation";
import type { Organization } from "@/domain/entities/clinic";
import type { Lead } from "@/domain/entities/lead";
import type { ConversationRepository } from "@/domain/repositories/conversation-repository";
import type { EditorialConfig } from "@/application/config/editorial-config";

export type LiveTurnRegistration = Readonly<{
  turnId: string;
  clinicId: string;
  leadId: string;
  conversationId: string;
  inboundMessageId: string;
  clinic: Organization;
  lead: Lead;
  conversation: Conversation;
  inboundMessage: Message;
  outboundAddress: string;
  editorial: EditorialConfig | null;
}>;

export type LiveTurnContext = LiveTurnRegistration & Readonly<{
  releaseLease(): Promise<void>;
}>;

export type LiveTurnSnapshot = Readonly<{
  history: readonly Message[];
  currentState: Readonly<ConversationStateRow> | null;
  lastResetBoundary: Date | null;
}>;

export type BeginLiveTurnResult =
  | { outcome: "duplicate"; reason: "external_id" | "recent_content" }
  | { outcome: "busy"; reason: "conversation_lease" }
  | { outcome: "ready"; context: LiveTurnContext };

export type BeginLiveTurnOptions = Readonly<{
  /**
   * Prepares engine-specific tenant configuration after the shared context is
   * valid, but before any inbound persistence or conversation lease.
   */
  beforeRegister?: (context: Readonly<{
    clinic: Organization;
    editorial: EditorialConfig | null;
  }>) => Promise<void>;
  /** Runs after the canonical inbound row is visible and before lease acquisition. */
  afterRegister?: (context: LiveTurnRegistration) => void | Promise<void>;
}>;

export class LiveTurnSetupError extends Error {
  constructor(readonly reason: "clinic_not_found") {
    super(reason);
    this.name = "LiveTurnSetupError";
  }
}

type LiveTurnLifecycleDependencies = Readonly<{
  registerIncomingMessage: RegisterIncomingMessage;
  conversationRepository: Pick<
    ConversationRepository,
    | "findMessageByExternalId"
    | "findRecentLeadMessageByIdentityAndContent"
    | "listMessages"
  >;
  contextReader: LiveConversationContextReader;
  turnCoordinator: Pick<ConversationTurnCoordinator, "acquire" | "release">;
  stateReader: Pick<
    ConversationStateMachine,
    "getCurrentState" | "getLastResetBoundary"
  >;
  now: () => Date;
}>;

// One worker invocation shares an orchestrator across its parallel job batch.
// Serialize the same provider id until its canonical messages row is visible.
// Across workers, durable ingress already collapses `(provider, providerMessageId)`
// to one inbound event/job and the job queue claims that row once. The messages
// unique index remains a final integrity check, not the side-effect gate.
const externalMessageTurnTails = new Map<string, Promise<void>>();

async function withExternalMessageTurnLock<T>(
  externalMessageId: string,
  run: () => Promise<T>,
): Promise<T> {
  const previous = externalMessageTurnTails.get(externalMessageId);
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  externalMessageTurnTails.set(externalMessageId, current);
  if (previous) await previous;
  try {
    return await run();
  } finally {
    release();
    if (externalMessageTurnTails.get(externalMessageId) === current) {
      externalMessageTurnTails.delete(externalMessageId);
    }
  }
}

export class LiveTurnLifecycle {
  constructor(private readonly deps: LiveTurnLifecycleDependencies) {}

  async begin(
    input: ConversationHandleInput,
    options: BeginLiveTurnOptions = {},
  ): Promise<BeginLiveTurnResult> {
    return withExternalMessageTurnLock(input.messageId, () =>
      this.beginExclusive(input, options));
  }

  private async beginExclusive(
    input: ConversationHandleInput,
    options: BeginLiveTurnOptions,
  ): Promise<BeginLiveTurnResult> {
    const existing = await this.deps.conversationRepository
      .findMessageByExternalId(input.messageId);
    if (existing) return { outcome: "duplicate", reason: "external_id" };

    const identifiers = buildContactIdentifiersFromWebhook({
      phone: input.phone,
      chatLid: input.whatsappLid,
    });
    const channelAddress = resolveWhatsAppChannelAddress(identifiers) ?? input.phone;
    const recent = await this.deps.conversationRepository
      .findRecentLeadMessageByIdentityAndContent({
        clinicId: input.clinicId,
        phone: identifiers.phone,
        whatsappLid: identifiers.whatsappLid,
        fallbackPhone: input.phone,
        body: input.messageText,
        sentAtOrAfter: new Date(this.deps.now().getTime() - 2 * 60_000),
      });
    if (recent) return { outcome: "duplicate", reason: "recent_content" };

    const clinic = await this.deps.contextReader.findOrganization(input.clinicId);
    if (!clinic) throw new LiveTurnSetupError("clinic_not_found");
    const editorial = await this.deps.contextReader.resolveEditorialConfig(input.clinicId);
    await options.beforeRegister?.(Object.freeze({ clinic, editorial }));

    const registered = await this.deps.registerIncomingMessage.execute({
      clinicId: input.clinicId,
      message: {
        externalMessageId: input.messageId,
        externalContactId: channelAddress,
        phone: input.phone,
        whatsappLid: input.whatsappLid ?? null,
        name: input.senderName ?? null,
        senderPhoto: input.senderPhoto ?? null,
        email: null,
        campaignId: null,
        channel: "whatsapp",
        externalThreadId: channelAddress,
        body: input.messageText,
        mediaUrl: input.mediaUrl ?? null,
        mediaType: input.mediaType ?? null,
        receivedAt: input.timestamp,
      },
    });

    // `messages_external_id_idx` remains the authority for races that pass both
    // preflight reads. Only the row that actually won that unique key proceeds.
    const persistedInbound = await this.deps.conversationRepository
      .findMessageByExternalId(input.messageId);
    if (!persistedInbound) return { outcome: "busy", reason: "conversation_lease" };
    if (persistedInbound.id !== registered.message.id) {
      return { outcome: "duplicate", reason: "external_id" };
    }

    const outboundAddress = resolveWhatsAppChannelAddress({
      phone: registered.lead.phone,
      whatsappLid: registered.lead.whatsappLid,
    }) ?? channelAddress;
    const registration: LiveTurnRegistration = Object.freeze({
      turnId: input.turnId ?? input.messageId,
      clinicId: input.clinicId,
      leadId: registered.lead.id,
      conversationId: registered.conversation.id,
      inboundMessageId: persistedInbound.id,
      clinic,
      lead: registered.lead,
      conversation: registered.conversation,
      inboundMessage: persistedInbound,
      outboundAddress,
      editorial,
    });
    await options.afterRegister?.(registration);

    const claimed = await this.deps.turnCoordinator.acquire(registered.conversation.id);
    if (!claimed) return { outcome: "busy", reason: "conversation_lease" };

    let releasePromise: Promise<void> | null = null;
    const releaseLease = async () => {
      releasePromise ??= this.deps.turnCoordinator.release(registered.conversation.id);
      await releasePromise;
    };
    const context: LiveTurnContext = Object.freeze({
      ...registration,
      releaseLease,
    });
    return { outcome: "ready", context };
  }

  async loadSnapshot(
    context: LiveTurnContext,
    options: { stateAsOf?: Date } = {},
  ): Promise<LiveTurnSnapshot> {
    const [history, currentState, lastResetBoundary] = await Promise.all([
      this.deps.conversationRepository.listMessages(context.conversationId),
      this.deps.stateReader.getCurrentState(context.conversationId, options.stateAsOf),
      this.deps.stateReader.getLastResetBoundary(context.conversationId),
    ]);
    return Object.freeze({
      history: Object.freeze([...history]),
      currentState: currentState ? Object.freeze({ ...currentState }) : null,
      lastResetBoundary: lastResetBoundary
        ? new Date(lastResetBoundary.getTime())
        : null,
    });
  }

  async complete(input: {
    context: LiveTurnContext;
    replied: boolean;
    reason?: string;
  }): Promise<void> {
    await input.context.releaseLease();
  }

  async fail(input: { context: LiveTurnContext; error: unknown }): Promise<void> {
    await input.context.releaseLease();
  }
}
