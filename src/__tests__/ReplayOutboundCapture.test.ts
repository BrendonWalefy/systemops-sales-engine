import { describe, expect, it } from "vitest";
import { ReplayOutboundCapture } from "@/application/replay/replay-outbound-capture";
import { createLogger } from "@/infrastructure/logging/logger";

const channelConfig = {
  provider: "z_api" as const,
  zapi: null,
  meta: null,
};

describe("ReplayOutboundCapture", () => {
  it("captura texto, voz e mídia em ordem sem exigir credenciais externas", async () => {
    const capture = new ReplayOutboundCapture();
    const boundary = capture.createBoundary();

    const text = await boundary.sendVoiceOrText!(
      "replay-contact",
      "Primeira resposta",
      channelConfig,
      false,
    );
    const voice = await boundary.sendVoiceOrText!(
      "replay-contact",
      "Resposta em voz",
      channelConfig,
      true,
    );
    const mediaId = await boundary.sendMediaMessage!(
      "replay-contact",
      "replay://media/video-1",
      "video",
      channelConfig,
      "Legenda",
    );

    expect(text).toEqual({
      msgId: "replay-capture-1",
      deliveryFormat: "text",
      blobUrl: null,
    });
    expect(voice).toEqual({
      msgId: "replay-capture-2",
      deliveryFormat: "audio",
      blobUrl: null,
    });
    expect(mediaId).toBe("replay-capture-3");
    expect(capture.effects).toEqual([
      expect.objectContaining({
        sequence: 1,
        kind: "text",
        content: "Primeira resposta",
      }),
      expect.objectContaining({
        sequence: 2,
        kind: "voice",
        content: "Resposta em voz",
      }),
      expect.objectContaining({
        sequence: 3,
        kind: "media",
        mediaType: "video",
        mediaRef: expect.stringMatching(/^[a-f0-9]{24}$/),
        caption: "Legenda",
      }),
    ]);
  });

  it("substitui polling e pacing externos na entrega multipartes", async () => {
    const capture = new ReplayOutboundCapture();
    const boundary = capture.createBoundary();
    const delivery = boundary.createDeliveryService!();
    const sent: string[] = [];

    await delivery.deliver({
      to: "replay-contact",
      config: channelConfig,
      log: createLogger({ scope: "ReplayOutboundCaptureTest" }),
      parts: [{
        type: "media",
        mediaId: "video-1",
        url: "replay://media/video-1",
        mediaType: "video",
        title: "Vídeo",
      }],
      sendText: async () => ({
        msgId: "unused",
        deliveryFormat: "text",
      }),
      onTextSent: async () => {},
      onMediaSent: async ({ msgId }) => {
        sent.push(msgId ?? "");
      },
    });

    expect(sent).toEqual(["replay-capture-1"]);
    expect(capture.effects).toHaveLength(1);
  });

  it("captura supressão por shadow mode como efeito explícito", async () => {
    const capture = new ReplayOutboundCapture();
    const boundary = capture.createBoundary();

    await boundary.recordSuppressedDelivery!({
      category: "conversation_reply",
      to: "replay-contact",
      content: "Resposta persistida, mas não enviada",
      intent: "general_question",
      reason: "shadow_mode",
    });

    expect(capture.effects).toEqual([
      {
        sequence: 1,
        kind: "suppressed",
        category: "conversation_reply",
        to: "replay-contact",
        content: "Resposta persistida, mas não enviada",
        intent: "general_question",
        reason: "shadow_mode",
      },
    ]);
  });
});
