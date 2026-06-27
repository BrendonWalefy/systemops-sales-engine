import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ZApiInboundPayload } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

const mocks = vi.hoisted(() => ({
  resolveClinicByZapiInstance: vi.fn(),
  persistInboundEventAndEnqueue: vi.fn(),
  isInternalOperationalWhatsAppMessage: vi.fn(),
  db: { select: vi.fn() },
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
    delete process.env.ZAPI_WEBHOOK_SECRET;
    mocks.resolveClinicByZapiInstance.mockResolvedValue("clinic-1");
    mocks.persistInboundEventAndEnqueue.mockResolvedValue({
      inboundEventId: "event-1",
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
