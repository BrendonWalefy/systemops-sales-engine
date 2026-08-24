import type { OutboundAuthorizationInput } from "@/application/ports/outbound-message-store";

type SettledInboundAuthority = Readonly<{
  streamId: string;
  streamGeneration: number;
  inboundEventId: string;
  claimJobId?: string;
  claimToken?: string;
}>;

export function authorizationForConversationReply(
  authority: SettledInboundAuthority | null | undefined,
): OutboundAuthorizationInput {
  if (authority?.claimJobId && authority.claimToken) {
    return {
      kind: "live_stream_reply",
      streamId: authority.streamId,
      streamGeneration: authority.streamGeneration,
      sourceInboundEventId: authority.inboundEventId,
      claimJobId: authority.claimJobId,
      claimToken: authority.claimToken,
    };
  }
  return { kind: "legacy" };
}
