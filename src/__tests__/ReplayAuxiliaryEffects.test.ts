import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConversationOrchestrator,
  type ConversationAuxiliaryExternalEffect,
} from "@/core/pipeline/ConversationOrchestrator";

describe("replay auxiliary external effects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("captura fronteiras auxiliares sem acessar rede, storage ou canal real", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network must not be reached");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("OPENAI_API_KEY", "test-replay-key");
    const effects: ConversationAuxiliaryExternalEffect[] = [];
    const orchestrator = new ConversationOrchestrator({
      suppressAuxiliaryExternalEffects: true,
      onAuxiliaryExternalEffect: (effect) => effects.push(effect),
    });
    const internal = orchestrator as unknown as {
      rehostInboundMedia(
        messageId: string,
        url: string,
        mediaType: "audio",
      ): Promise<void>;
      persistLeadPhoto(
        leadId: string,
        phone: string,
        credentials: unknown,
      ): Promise<void>;
      notifyOperators(clinicId: string, payload: unknown): Promise<void>;
      sendAuxiliaryTextMessage(
        to: string,
        text: string,
        config: unknown,
      ): Promise<string | null>;
      sendAuxiliaryMediaMessage(
        to: string,
        url: string,
        mediaType: "image",
        config: unknown,
      ): Promise<string | null>;
      sendAuxiliaryButtonListMessage(
        to: string,
        text: string,
        buttons: unknown[],
        config: unknown,
      ): Promise<string | null>;
    };

    await internal.rehostInboundMedia("message-1", "https://replay.invalid/a.ogg", "audio");
    await internal.persistLeadPhoto("lead-1", "5511000000000", {});
    await internal.notifyOperators("clinic-1", {
      title: "synthetic",
      body: "synthetic",
      url: "/app/inbox/synthetic",
    });
    await internal.sendAuxiliaryTextMessage("synthetic", "synthetic", {});
    await internal.sendAuxiliaryMediaMessage(
      "synthetic",
      "https://replay.invalid/a.jpg",
      "image",
      {},
    );
    await internal.sendAuxiliaryButtonListMessage(
      "synthetic",
      "synthetic",
      [],
      {},
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(effects).toEqual([
      { kind: "media_rehost", mediaType: "audio" },
      { kind: "lead_photo_lookup" },
      { kind: "operator_push" },
      { kind: "operator_whatsapp_text" },
      { kind: "operator_whatsapp_media", mediaType: "image" },
      { kind: "operator_whatsapp_buttons" },
    ]);
  });
});
