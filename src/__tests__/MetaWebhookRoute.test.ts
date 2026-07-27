import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveMetaWebhookTenant: vi.fn(),
  persistInboundEventAndEnqueue: vi.fn(),
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  resolveMetaWebhookTenant: mocks.resolveMetaWebhookTenant,
}));
vi.mock("@/application/whatsapp/persist-inbound-event", () => ({
  persistInboundEventAndEnqueue: mocks.persistInboundEventAndEnqueue,
}));

import { POST } from "@/app/api/whatsapp/webhook/route";

const META_APP_SECRET = "test-meta-app-secret";

function request(body: unknown, options?: { signature?: string | null }) {
  const rawBody = JSON.stringify(body);
  const signature = options?.signature === undefined
    ? `sha256=${createHmac("sha256", META_APP_SECRET).update(rawBody).digest("hex")}`
    : options.signature;
  return new NextRequest("http://systemops.test/api/whatsapp/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature ? { "x-hub-signature-256": signature } : {}),
    },
    body: rawBody,
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
    mocks.resolveMetaWebhookTenant.mockResolvedValue({
      clinicId: "clinic-1",
      encryptedAppSecret: META_APP_SECRET,
    });
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
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: "phone-number-1" },
        statuses: [{ id: "wamid.status" }],
      } }] }],
    }));

    expect(response.status).toBe(200);
    expect(mocks.persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("retorna erro para a Meta retentar quando o tenant não é resolvido", async () => {
    mocks.resolveMetaWebhookTenant.mockResolvedValue(null);

    const response = await POST(request(metaTextPayload()));

    expect(response.status).toBe(500);
    expect(mocks.persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("rejeita assinatura ausente ou inválida antes de persistir", async () => {
    const missing = await POST(request(metaTextPayload(), { signature: null }));
    const invalid = await POST(request(metaTextPayload(), { signature: `sha256=${"0".repeat(64)}` }));

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
    expect(mocks.persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });

  it("falha fechado quando o tenant Meta não possui App Secret", async () => {
    mocks.resolveMetaWebhookTenant.mockResolvedValue({
      clinicId: "clinic-1",
      encryptedAppSecret: null,
    });

    const response = await POST(request(metaTextPayload()));

    expect(response.status).toBe(503);
    expect(mocks.persistInboundEventAndEnqueue).not.toHaveBeenCalled();
  });
});
