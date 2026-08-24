import type { IncomingChannelMessage } from "@/application/ports/channel-adapter";
import type { InboundAuthorityTuple } from "@/application/ports/inbound-event-store";
import type { WhatsAppStreamAuthority } from "@/application/ports/whatsapp-stream-authority";
import {
  RegisterIncomingMessage,
  type PreparedInboundHistory,
} from "@/application/use-cases/leads/register-incoming-message";

export type RegisterInboundHistoryInput = Readonly<{
  clinicId: string;
  message: IncomingChannelMessage;
  authority: InboundAuthorityTuple;
}>;

export interface InboundHistoryRegistrar {
  prepare(input: RegisterInboundHistoryInput): Promise<PreparedInboundHistory>;
}

export class RegisterInboundHistory implements InboundHistoryRegistrar {
  constructor(private readonly deps: Readonly<{
    registerIncomingMessage: RegisterIncomingMessage;
    streamAuthority: Pick<WhatsAppStreamAuthority, "bindStreamToConversation">;
    now: () => Date;
  }>) {}

  async prepare(input: RegisterInboundHistoryInput): Promise<PreparedInboundHistory> {
    const prepared = await this.deps.registerIncomingMessage.prepareInboundHistory({
      clinicId: input.clinicId,
      message: input.message,
      inboundAuthority: input.authority,
    });
    if (prepared.messageInserted || prepared.authorityMatchedExisting) {
      await this.deps.streamAuthority.bindStreamToConversation({
        clinicId: input.clinicId,
        conversationId: prepared.conversation.id,
        ...input.authority,
        now: this.deps.now(),
      });
    }
    return prepared;
  }
}
