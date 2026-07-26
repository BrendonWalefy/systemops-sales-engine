import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { select: vi.fn(), update: vi.fn() },
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  resolveChannelConfig: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));
vi.mock("@/infrastructure/adapters/channels/whatsapp/channel-config", () => ({
  resolveChannelConfig: mocks.resolveChannelConfig,
}));

import {
  deliverOperatorOutbound,
  type OutboundDeliveryBoundary,
} from "@/application/jobs/send-message-job";

function clinicQuery() {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ id: "clinic-1" }]),
  };
}

function boundary(): OutboundDeliveryBoundary {
  return {
    sandboxCaptureEnabled: false,
    sendVoiceOrText: vi.fn().mockResolvedValue({
      msgId: "provider-text-1",
      deliveryFormat: "text",
      blobUrl: null,
    }),
    sendMediaMessage: vi.fn().mockResolvedValue("provider-media-1"),
    createDeliveryService: vi.fn() as never,
    recordSuppressedDelivery: vi.fn(),
  };
}

describe("operator outbound delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReturnValue(clinicQuery());
    mocks.updateWhere.mockResolvedValue(undefined);
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    mocks.db.update.mockReturnValue({ set: mocks.updateSet });
    mocks.resolveChannelConfig.mockReturnValue({
      provider: "z_api",
      zapi: { instanceId: "instance-1", token: "token-1" },
      meta: null,
    });
  });

  it("envia texto pelo boundary do sender e grava o id externo", async () => {
    const deps = boundary();
    await expect(deliverOperatorOutbound({
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      payload: {
        version: 1,
        kind: "operator_message",
        to: "5511999999999",
        operatorMessageId: "operator-message-1",
        text: "Olá",
      },
    }, deps)).resolves.toBe("provider-text-1");

    expect(deps.sendVoiceOrText).toHaveBeenCalledWith(
      "5511999999999",
      "Olá",
      expect.objectContaining({ provider: "z_api" }),
      false,
    );
    expect(mocks.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      externalId: "provider-text-1",
      deliveryFormat: "text",
    }));
  });

  it("envia anexo uma única vez pelo boundary do sender", async () => {
    const deps = boundary();
    await expect(deliverOperatorOutbound({
      clinicId: "clinic-1",
      conversationId: "conversation-1",
      payload: {
        version: 1,
        kind: "operator_message",
        to: "5511999999999",
        operatorMessageId: "operator-message-1",
        text: "Segue",
        attachment: {
          url: "https://blob.example/proposta.pdf",
          mediaType: "document",
          fileName: "proposta.pdf",
        },
      },
    }, deps)).resolves.toBe("provider-media-1");

    expect(deps.sendMediaMessage).toHaveBeenCalledWith(
      "5511999999999",
      "https://blob.example/proposta.pdf",
      "document",
      expect.objectContaining({ provider: "z_api" }),
      "Segue",
      "proposta.pdf",
    );
    expect(deps.sendVoiceOrText).not.toHaveBeenCalled();
  });
});
