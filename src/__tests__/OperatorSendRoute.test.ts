import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getSessionClinicId: vi.fn(),
  head: vi.fn(),
  enqueueOutboundMessage: vi.fn(),
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  insertValues: vi.fn(),
  insertOnConflict: vi.fn(),
  insertReturning: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  getSessionClinicId: mocks.getSessionClinicId,
}));
vi.mock("@vercel/blob", () => ({ head: mocks.head }));
vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));
vi.mock("@/application/jobs/enqueue-outbound-message", () => ({
  enqueueOutboundMessage: mocks.enqueueOutboundMessage,
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
    body: JSON.stringify({
      message,
      attachment,
      clientMessageId: "10000000-0000-4000-8000-000000000001",
    }),
  });
}

describe("operator send route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.getSessionClinicId.mockResolvedValue("clinic-1");
    mocks.head.mockResolvedValue({
      url: "https://blob.example/proposta.pdf",
      pathname: "media/inbox/conversation-1/proposta-random.pdf",
      contentType: "application/pdf",
      size: 3,
    });
    mocks.enqueueOutboundMessage.mockResolvedValue({
      outboundMessageId: "outbound-1",
      messageWasNew: true,
      jobWasNew: true,
    });
    mocks.insertReturning.mockResolvedValue([{ id: "10000000-0000-4000-8000-000000000001" }]);
    mocks.insertOnConflict.mockReturnValue({ returning: mocks.insertReturning });
    mocks.insertValues.mockReturnValue({ onConflictDoNothing: mocks.insertOnConflict });
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
      .mockReturnValueOnce(query([{ phone: "5511999999999", whatsappLid: null }]));
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
    expect(mocks.enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  it("não permite anexar em conversa de outra clínica", async () => {
    mocks.db.select.mockReset().mockReturnValueOnce(query([]));
    const response = await POST(jsonRequest("", {
      url: "https://blob.example/proposta.pdf",
      fileName: "proposta.pdf",
    }), context("other-conversation"));

    expect(response.status).toBe(404);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  it("faz upload, envia a mídia e persiste seus metadados no histórico", async () => {
    const response = await POST(jsonRequest("Segue a proposta", {
      url: "https://blob.example/proposta.pdf",
      fileName: "Proposta Comercial.pdf",
    }), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      queued: true,
      outboundMessageId: "outbound-1",
      mediaType: "document",
    });
    expect(mocks.head).toHaveBeenCalledWith("https://blob.example/proposta.pdf");
    expect(mocks.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation-1",
      author: "clinic_user",
      body: "Segue a proposta",
      mediaUrl: "https://blob.example/proposta.pdf",
      mediaType: "document",
    }));
    expect(mocks.enqueueOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        dedupeKey: "operator:10000000-0000-4000-8000-000000000001",
        payload: expect.objectContaining({
          kind: "operator_message",
          attachment: expect.objectContaining({ mediaType: "document" }),
        }),
      }),
      expect.any(Object),
    );
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
    expect(mocks.enqueueOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryKind: "text",
        payload: expect.objectContaining({
          kind: "operator_message",
          text: "Oi, tudo bem?",
        }),
      }),
      expect.any(Object),
    );
  });

  it("repara o enqueue sem duplicar a mensagem quando o cliente repete o mesmo UUID", async () => {
    mocks.insertReturning.mockResolvedValueOnce([]);
    mocks.db.select
      .mockReset()
      .mockReturnValueOnce(query([{
        id: "conversation-1",
        clinicId: "clinic-1",
        leadId: "lead-1",
        externalThreadId: null,
      }]))
      .mockReturnValueOnce(query([{ takeoverTtlHours: 4 }]))
      .mockReturnValueOnce(query([{ phone: "5511999999999", whatsappLid: null }]))
      .mockReturnValueOnce(query([{
        conversationId: "conversation-1",
        body: "Oi novamente",
        mediaUrl: null,
        mediaType: null,
      }]));

    const response = await POST(jsonRequest("Oi novamente"), context());

    expect(response.status).toBe(200);
    expect(mocks.enqueueOutboundMessage).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueOutboundMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "operator:10000000-0000-4000-8000-000000000001",
      }),
      expect.any(Object),
    );
  });
});
