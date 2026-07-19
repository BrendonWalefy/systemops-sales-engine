import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionClinicId: vi.fn(),
  head: vi.fn(),
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  resolveChannelConfig: vi.fn(),
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  getSessionClinicId: mocks.getSessionClinicId,
}));
vi.mock("@vercel/blob", () => ({ head: mocks.head }));
vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));
vi.mock("@/infrastructure/adapters/channels/whatsapp/whatsapp-sender", () => ({
  sendTextMessage: mocks.sendTextMessage,
  sendMediaMessage: mocks.sendMediaMessage,
}));
vi.mock("@/infrastructure/adapters/channels/whatsapp/channel-config", () => ({
  resolveChannelConfig: mocks.resolveChannelConfig,
}));

import { POST } from "@/app/api/conversations/[conversationId]/send/route";

function query(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function context(conversationId = "conversation-1") {
  return { params: Promise.resolve({ conversationId }) };
}

function jsonRequest(message: string, attachment?: { url: string; fileName: string }) {
  return new NextRequest("http://systemops.test/api/conversations/conversation-1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, attachment }),
  });
}

describe("operator send route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionClinicId.mockResolvedValue("clinic-1");
    mocks.resolveChannelConfig.mockReturnValue({
      provider: "z_api",
      zapi: { instanceId: "instance-1", token: "token-1" },
      meta: null,
    });
    mocks.head.mockResolvedValue({
      url: "https://blob.example/proposta.pdf",
      pathname: "media/inbox/conversation-1/proposta-random.pdf",
      contentType: "application/pdf",
      size: 3,
    });
    mocks.sendTextMessage.mockResolvedValue("text-message-1");
    mocks.sendMediaMessage.mockResolvedValue("media-message-1");
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.db.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.db.update.mockReturnValue({ set: mocks.updateSet });
    mocks.db.select
      .mockReturnValueOnce(query([{
        id: "conversation-1",
        clinicId: "clinic-1",
        leadId: "lead-1",
        externalThreadId: null,
      }]))
      .mockReturnValueOnce(query([{ takeoverTtlHours: 4 }]))
      .mockReturnValueOnce(query([{ phone: "5511999999999", whatsappLid: null }]))
      .mockReturnValueOnce(query([{
        channelProvider: "z_api",
        zapiInstanceId: "instance-1",
        zapiToken: "token-1",
        zapiClientToken: null,
        metaPhoneNumberId: null,
        metaAccessToken: null,
      }]));
  });

  it("bloqueia envio sem sessão antes de consultar dados", async () => {
    mocks.getSessionClinicId.mockResolvedValue(null);

    const response = await POST(jsonRequest("Oi"), context());

    expect(response.status).toBe(401);
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("recusa formato de anexo não permitido", async () => {
    mocks.head.mockResolvedValueOnce({
      url: "https://blob.example/programa.exe",
      pathname: "media/inbox/conversation-1/programa.exe",
      contentType: "application/octet-stream",
      size: 3,
    });

    const response = await POST(jsonRequest("", {
      url: "https://blob.example/programa.exe",
      fileName: "programa.exe",
    }), context());

    expect(response.status).toBe(422);
    expect(mocks.sendMediaMessage).not.toHaveBeenCalled();
  });

  it("não permite anexar em conversa de outra clínica", async () => {
    mocks.db.select.mockReset().mockReturnValueOnce(query([]));
    const response = await POST(jsonRequest("", {
      url: "https://blob.example/proposta.pdf",
      fileName: "proposta.pdf",
    }), context("other-conversation"));

    expect(response.status).toBe(404);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.sendMediaMessage).not.toHaveBeenCalled();
  });

  it("faz upload, envia a mídia e persiste seus metadados no histórico", async () => {
    const response = await POST(jsonRequest("Segue a proposta", {
      url: "https://blob.example/proposta.pdf",
      fileName: "Proposta Comercial.pdf",
    }), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, mediaType: "document" });
    expect(mocks.head).toHaveBeenCalledWith("https://blob.example/proposta.pdf");
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation-1",
      author: "clinic_user",
      body: "Segue a proposta",
      mediaUrl: "https://blob.example/proposta.pdf",
      mediaType: "document",
    }));
    expect(mocks.sendMediaMessage).toHaveBeenCalledWith(
      "5511999999999",
      "https://blob.example/proposta.pdf",
      "document",
      expect.objectContaining({ provider: "z_api" }),
      "Segue a proposta",
      "Proposta Comercial.pdf",
    );
    expect(mocks.updateSet).toHaveBeenCalledWith({ externalId: "media-message-1" });
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      aiPaused: true,
      needsAttention: false,
      attentionReason: null,
    }));
  });

  it("preserva o envio de texto sem upload", async () => {
    const response = await POST(jsonRequest("Oi, tudo bem?"), context());

    expect(response.status).toBe(200);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.sendMediaMessage).not.toHaveBeenCalled();
    expect(mocks.sendTextMessage).toHaveBeenCalledWith(
      "5511999999999",
      "Oi, tudo bem?",
      expect.objectContaining({ provider: "z_api" }),
    );
  });
});
