import { describe, expect, it } from "vitest";
import type { Message } from "@/domain/entities/conversation";
import { InMemoryDemoStore } from "@/infrastructure/repositories/in-memory-demo-repositories";

describe("InMemoryDemoStore conversation messages", () => {
  it("reads a sender-owned message by deterministic internal id", async () => {
    const store = new InMemoryDemoStore();
    const message: Message = {
      id: "agent-message-1",
      conversationId: "conversation-1",
      author: "agent",
      body: "Olá",
      mediaUrl: null,
      mediaType: null,
      sentAt: new Date("2026-08-17T12:00:00.000Z"),
      externalId: null,
      intent: null,
      deliveryFormat: null,
    };
    await store.appendMessage(message);

    await expect(store.findMessageById(message.id)).resolves.toEqual(message);
    await expect(store.findMessageById("missing")).resolves.toBeNull();
  });
});
