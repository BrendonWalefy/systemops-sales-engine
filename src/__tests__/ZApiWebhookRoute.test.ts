import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  resolveClinicByZapiInstance: vi.fn(),
  persistInboundEventAndEnqueue: vi.fn(),
  isInternalOperationalWhatsAppMessage: vi.fn(),
  db: { select: vi.fn() },
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  resolveClinicByZapiInstance: mocks.resolveClinicByZapiInstance,
}));

vi.mock("@/application/whatsapp/persist-inbound-event", () => ({
  persistInboundEventAndEnqueue: mocks.persistInboundEventAndEnqueue,
}));

vi.mock("@/core/whatsapp/InternalWhatsAppOperationalMessage", () => ({
  isInternalOperationalWhatsAppMessage: mocks.isInternalOperationalWhatsAppMessage,
}));

vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));

import { POST } from "@/app/api/whatsapp/zapi/route";

function payload(overrides: Partial<ZApiInboundPayload> = {}): ZApiInboundPayload {
  return {
    phone: "5511999999999",
    instanceId: "instance-1",
    messageId: "message-1",
    momment: 1_719_144_000_000,
    status: "RECEIVED_MESSAGE",
    chatName: "Lead",
    senderName: "Lead",
    isGroupMsg: false,
    isStatusReply: false,
    isEdit: false,
    fromMe: false,
    ...overrides,
  };
}

function clinicQuery(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function request(body: ZApiInboundPayload): NextRequest {
  return new NextRequest("http://systemops.test/api/whatsapp/zapi", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("Z-API webhook durable ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockReset();
    delete process.env.ZAPI_WEBHOOK_SECRET;
    mocks.resolveClinicByZapiInstance.mockResolvedValue("clinic-1");
    mocks.persistInboundEventAndEnqueue.mockResolvedValue({
      outcome: "registered",
      inboundEventId: "event-1",
      streamId: "stream-1",
      streamGeneration: 1,
      jobId: "job-1",
      runAt: new Date("2026-08-25T12:00:15.000Z"),
      eventWasNew: true,
      jobWasNew: true,
    });
    mocks.isInternalOperationalWhatsAppMessage.mockReturnValue(false);
    mocks.db.select.mockReturnValue(
      clinicQuery([{ receptionistPhone: null, takeoverTtlHours: 4 }]),
    );
  });

  it("persiste e enfileira um webhook sem texto para o worker decidir depois", async () => {
    const response = await POST(request(payload({ messageId: "without-text" })));

    expect(response.status).toBe(200);
    expect(mocks.persistInboundEventAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        providerMessageId: "without-text",
        normalizedText: null,
        mediaType: null,
      }),
      expect.any(Object),
    );
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("não agenda outro wake para uma entrega duplicada do provedor", async () => {
    mocks.persistInboundEventAndEnqueue.mockResolvedValue({
      outcome: "registered",
      inboundEventId: "event-1",
      streamId: "stream-1",
      streamGeneration: 1,
      jobId: "job-1",
      runAt: new Date("2026-08-25T12:00:15.000Z"),
      eventWasNew: false,
      jobWasNew: false,
    });

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("mantém o webhook bem-sucedido quando o agendamento do wake falha", async () => {
    mocks.after.mockImplementation(() => {
      throw new Error("request scope unavailable");
    });

    const response = await POST(request(payload()));

    expect(response.status).toBe(200);
    expect(mocks.persistInboundEventAndEnqueue).toHaveBeenCalledOnce();
    expect(mocks.after).toHaveBeenCalledOnce();
  });

  it("não enfileira mensagem fromMe", async () => {
    const response = await POST(request(payload({ fromMe: true })));

    expect(response.status).toBe(200);
    expect(mocks.persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("retorna erro para que a Z-API retente quando não encontra a clínica", async () => {
    mocks.resolveClinicByZapiInstance.mockResolvedValue(null);

    const response = await POST(request(payload()));

    expect(response.status).toBe(500);
    expect(mocks.persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });
});
