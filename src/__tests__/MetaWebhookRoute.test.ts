import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveClinicByMetaPhoneNumberId: vi.fn(),
  persistInboundEventAndEnqueue: vi.fn(),
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  resolveClinicByMetaPhoneNumberId: mocks.resolveClinicByMetaPhoneNumberId,
}));
vi.mock("@/application/whatsapp/persist-inbound-event", () => ({
  persistInboundEventAndEnqueue: mocks.persistInboundEventAndEnqueue,
}));

import { POST } from "@/app/api/whatsapp/webhook/route";

function request(body: unknown) {
  return new NextRequest("http://systemops.test/api/whatsapp/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function metaTextPayload() {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "phone-number-1" },
          contacts: [{ profile: { name: "Lead Meta" } }],
          messages: [{
            id: "wamid.meta-1",
            from: "5511888888888",
            timestamp: "1785067200",
            type: "text",
            text: { body: "Olá pelo Meta" },
          }],
        },
      }],
    }],
  };
}

describe("Meta webhook durable ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveClinicByMetaPhoneNumberId.mockResolvedValue("clinic-1");
    mocks.persistInboundEventAndEnqueue.mockResolvedValue({
      inboundEventId: "event-1",
      eventWasNew: true,
      jobWasNew: true,
    });
  });

  it("persiste o payload bruto e enfileira antes de responder OK", async () => {
    const body = metaTextPayload();
    const response = await POST(request(body));

    expect(response.status).toBe(200);
    expect(mocks.persistInboundEventAndEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: "clinic-1",
        provider: "meta_cloud_api",
        providerMessageId: "wamid.meta-1",
        conversationKey: "5511888888888",
        normalizedText: "Olá pelo Meta",
        dedupeKey: "meta:phone-number-1:wamid.meta-1",
        payload: body,
      }),
      expect.any(Object),
    );
  });

  it("ignora status update sem criar trabalho", async () => {
    const response = await POST(request({
      entry: [{ changes: [{ value: { statuses: [{ id: "wamid.status" }] } }] }],
    }));

    expect(response.status).toBe(200);
    expect(mocks.persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("retorna erro para a Meta retentar quando o tenant não é resolvido", async () => {
    mocks.resolveClinicByMetaPhoneNumberId.mockResolvedValue(null);

    const response = await POST(request(metaTextPayload()));

    expect(response.status).toBe(500);
    expect(mocks.persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });
});
