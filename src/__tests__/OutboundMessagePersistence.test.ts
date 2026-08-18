import { describe, expect, it } from "vitest";

import {
  buildAgentMessageFromOutboundPart,
  buildInitialAgentMessage,
} from "@/core/pipeline/outbound-message-persistence";

describe("Outbound message persistence helpers", () => {
  it("rebuilds the same sender placeholder identity on an outbox retry", () => {
    const input = {
      id: "conversation-v2-agent-turn-1",
      conversationId: "conversation-1",
      replyText: "Posso confirmar o horário?",
      sentAt: new Date("2026-08-17T15:02:00.000Z"),
      intent: "book_appointment" as const,
      hasInterleavedMedia: false,
      outboundParts: [],
    };

    const firstAttempt = buildInitialAgentMessage(input);
    const retry = buildInitialAgentMessage(input);

    expect(retry).toEqual(firstAttempt);
    expect(retry).toMatchObject({
      id: "conversation-v2-agent-turn-1",
      conversationId: "conversation-1",
      author: "agent",
      body: "Posso confirmar o horário?",
      externalId: null,
    });
  });

  it("usa a primeira parte exata quando a resposta é intercalada", () => {
    const message = buildInitialAgentMessage({
      id: "msg-1",
      conversationId: "conv-1",
      replyText: "Texto combinado que não deve ser persistido aqui",
      sentAt: new Date("2026-06-11T10:00:00Z"),
      intent: "general_question",
      hasInterleavedMedia: true,
      outboundParts: [
        { type: "text", content: "Sobre a Simplificada..." },
        {
          type: "media",
          mediaId: "video-1",
          url: "https://blob/video.mp4",
          mediaType: "video",
          title: "Lentes - Tecnica Simplificada",
        },
      ],
    });

    expect(message.body).toBe("Sobre a Simplificada...");
    expect(message.mediaUrl).toBeNull();
    expect(message.externalId).toBeNull();
  });

  it("persiste mídia outbound com título exato, url, tipo e externalId", () => {
    const message = buildAgentMessageFromOutboundPart({
      id: "msg-2",
      conversationId: "conv-1",
      sentAt: new Date("2026-06-11T10:00:00Z"),
      intent: "general_question",
      externalId: "zapi-media-123",
      part: {
        type: "media",
        mediaId: "video-1",
        url: "https://blob/video.mp4",
        mediaType: "video",
        title: "Lentes - Tecnica Simplificada",
      },
    });

    expect(message.body).toBe("Lentes - Tecnica Simplificada");
    expect(message.mediaUrl).toBe("https://blob/video.mp4");
    expect(message.mediaType).toBe("video");
    expect(message.externalId).toBe("zapi-media-123");
  });
});
