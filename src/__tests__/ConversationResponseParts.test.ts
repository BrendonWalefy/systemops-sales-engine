import { describe, expect, it } from "vitest";
import { resolveOutboundParts } from "@/core/conversation/conversation-response-parts";
import { createLogger } from "@/infrastructure/logging/logger";

describe("conversation response parts", () => {
  const log = createLogger({ scope: "ConversationResponsePartsTest" });

  it("preserva a ordem texto-mídia-texto", () => {
    const result = resolveOutboundParts(
      [
        { type: "text", content: "Antes" },
        { type: "media", id: "media-1", caption: "Legenda" },
        { type: "text", content: "Depois" },
      ],
      [{
        id: "media-1",
        title: "Caso autorizado",
        type: "video",
        url: "https://example.invalid/video",
        treatmentId: null,
      }],
      log,
      null,
    );

    expect(result.map((part) => part.type)).toEqual(["text", "media", "text"]);
  });
});
