import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/domain/entities/conversation";

const dbMock = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

const bumpInboxVersionMock = vi.hoisted(() => vi.fn());
vi.mock("@/application/read-versions/clinic-read-version", () => ({
  bumpInboxVersion: bumpInboxVersionMock,
}));

import { DrizzleConversationRepository } from "@/infrastructure/repositories/drizzle-conversation-repository";

function insertChain(returningRows: Array<{ id: string }> = [{ id: "msg-1" }]) {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returningRows),
  };
}

function updateChain(returningRows: Array<{ clinicId: string }>) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(returningRows),
  };
}

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    author: "lead",
    body: "Oi",
    mediaUrl: null,
    mediaType: null,
    sentAt: new Date("2026-08-10T00:00:00.000Z"),
    externalId: "ext-1",
    intent: null,
    deliveryFormat: null,
    ...overrides,
  };
}

describe("DrizzleConversationRepository.appendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(
    "marca a versão da inbox com o clinicId devolvido pelo próprio update — a mensagem real, " +
      "não a foto de perfil ou o toggle de config, é o caminho mais executado do produto",
    async () => {
      dbMock.insert.mockReturnValue(insertChain());
      dbMock.update.mockReturnValue(updateChain([{ clinicId: "clinic-42" }]));

      const inserted = await new DrizzleConversationRepository().appendMessage(
        message({ conversationId: "conv-1" }),
      );

      expect(inserted).toBe(true);
      expect(bumpInboxVersionMock).toHaveBeenCalledWith("clinic-42");
      expect(bumpInboxVersionMock).toHaveBeenCalledOnce();
    },
  );

  it(
    "não marca a versão da inbox quando o update de conversations não atinge nenhuma linha " +
      "(conversa deletada concorrentemente — não há clinicId nenhum pra marcar)",
    async () => {
      dbMock.insert.mockReturnValue(insertChain());
      dbMock.update.mockReturnValue(updateChain([]));

      await new DrizzleConversationRepository().appendMessage(message({ conversationId: "conv-ausente" }));

      expect(bumpInboxVersionMock).not.toHaveBeenCalled();
    },
  );

  it("does not update the conversation or bump Inbox when the external-id insert loses", async () => {
    dbMock.insert.mockReturnValue(insertChain([]));

    const inserted = await new DrizzleConversationRepository().appendMessage(message());

    expect(inserted).toBe(false);
    expect(dbMock.update).not.toHaveBeenCalled();
    expect(bumpInboxVersionMock).not.toHaveBeenCalled();
  });
});

describe("DrizzleConversationRepository.findMessageById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the deterministic internal message id used by sender-owned retries", async () => {
    dbMock.select.mockReturnValue(selectChain([{
      id: "msg-1",
      conversationId: "conv-1",
      author: "agent",
      body: "Oi",
      mediaUrl: null,
      mediaType: null,
      sentAt: new Date("2026-08-10T00:00:00.000Z"),
      externalId: null,
      intent: null,
      deliveryFormat: null,
      simulated: false,
    }]));

    await expect(new DrizzleConversationRepository().findMessageById("msg-1"))
      .resolves.toMatchObject({ id: "msg-1", author: "agent" });
  });
});
