import { describe, expect, it, vi } from "vitest";
import {
  resolveLeadInboundContent,
  resolveUnsupportedInboundPlaceholder,
} from "@/infrastructure/adapters/channels/whatsapp/zapi-webhook-content";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

function basePayload(): ZApiInboundPayload {
  return {
    phone: "5511999999999",
    instanceId: "instance-1",
    messageId: "msg-1",
    momment: Date.now(),
    status: "RECEIVED_MESSAGE",
    chatName: "Lead",
    senderName: "Lead",
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe: false,
  };
}

describe("zapi-webhook-content", () => {
  it("persiste figurinha inbound como placeholder sem resposta automática", async () => {
    const result = await resolveLeadInboundContent({
      payload: {
        ...basePayload(),
        sticker: { stickerUrl: "https://cdn.z-api.io/sticker.webp", mimeType: "image/webp" },
      },
      replyEnabled: true,
      transcribeAudio: vi.fn(),
    });

    expect(result).toEqual({
      messageText: "[figurinha recebida]",
      shouldReply: false,
    });
  });

  it("persiste reação inbound com emoji visível", async () => {
    const result = await resolveLeadInboundContent({
      payload: {
        ...basePayload(),
        reaction: { emoji: "👍" },
      },
      replyEnabled: true,
      transcribeAudio: vi.fn(),
    });

    expect(result).toEqual({
      messageText: "[reação recebida] 👍",
      shouldReply: false,
    });
  });

  it("mantém áudio com transcrição e mídia quando a IA pode responder", async () => {
    const result = await resolveLeadInboundContent({
      payload: {
        ...basePayload(),
        audio: { audioUrl: "https://cdn.z-api.io/audio.ogg", mimeType: "audio/ogg" },
      },
      replyEnabled: true,
      transcribeAudio: vi.fn().mockResolvedValue("Quero remarcar"),
    });

    expect(result).toEqual({
      messageText: "[áudio] Quero remarcar",
      mediaUrl: "https://cdn.z-api.io/audio.ogg",
      mediaType: "audio",
      shouldReply: true,
    });
  });

  it("áudio com IA desligada vira placeholder, sem transcrição", async () => {
    const transcribeAudio = vi.fn();
    const result = await resolveLeadInboundContent({
      payload: {
        ...basePayload(),
        audio: { audioUrl: "https://cdn.z-api.io/audio.ogg", mimeType: "audio/ogg" },
      },
      replyEnabled: false,
      transcribeAudio,
    });

    expect(result).toEqual({
      messageText: "[áudio recebido]",
      mediaUrl: "https://cdn.z-api.io/audio.ogg",
      mediaType: "audio",
      shouldReply: false,
    });
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  it("placeholder do operador usa texto distinto", () => {
    const result = resolveUnsupportedInboundPlaceholder(
      {
        ...basePayload(),
        fromMe: true,
        sticker: { stickerUrl: "https://cdn.z-api.io/sticker.webp", mimeType: "image/webp" },
      },
      "operator",
    );

    expect(result).toBe("[figurinha enviada pelo operador]");
  });
});
