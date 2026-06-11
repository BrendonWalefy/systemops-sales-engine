// Fix do bug de mídia fora de ordem: o POST de mídia na Z-API retorna ACK
// imediato, mas a entrega real é assíncrona (Z-API baixa a URL antes de enviar).
// O OutboundDeliveryService aguarda a confirmação via message-status antes de
// enviar a próxima parte, garantindo a ordem texto → vídeo → texto no WhatsApp.

import { describe, it, expect, vi } from "vitest";
import {
  OutboundDeliveryService,
  type OutboundPart,
} from "@/infrastructure/adapters/channels/whatsapp/outbound-delivery-service";
import type { ClinicChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { createLogger } from "@/infrastructure/logging/logger";

const zapiConfig = {
  provider: "z_api",
  zapi: { instanceId: "i", token: "t" },
  meta: null,
} as unknown as ClinicChannelConfig;

const silentLog = createLogger({ scope: "test" });

function makeParts(): OutboundPart[] {
  return [
    { type: "text", content: "Sobre a Simplificada..." },
    { type: "media", mediaId: "vid-simplificada", url: "https://blob/v1.mp4", mediaType: "video", title: "Lentes – Técnica Simplificada" },
    { type: "text", content: "Sobre a Estratificada..." },
    { type: "media", mediaId: "vid-estratificada", url: "https://blob/v2.mp4", mediaType: "video", title: "Lentes – Técnica Estratificada" },
  ];
}

function makeService(opts: {
  statusSequence: ("delivered" | "pending" | "unsupported")[];
  events: string[];
  sendMediaImpl?: () => Promise<string | null>;
}) {
  let statusCall = 0;
  const statusCalls: string[] = [];
  const service = new OutboundDeliveryService({
    minGapMs: 0,
    deliveryTimeoutMs: 100,
    pollIntervalMs: 1,
    sleep: () => Promise.resolve(),
    sendMedia: vi.fn(async (_to, url) => {
      opts.events.push(`media_post:${url}`);
      return opts.sendMediaImpl ? await opts.sendMediaImpl() : `zapi-${url}`;
    }),
    getDeliveryStatus: vi.fn(async (msgId) => {
      statusCalls.push(msgId);
      const status = opts.statusSequence[Math.min(statusCall, opts.statusSequence.length - 1)];
      statusCall++;
      opts.events.push(`status_check:${status}`);
      return status;
    }),
  });
  return { service, statusCalls };
}

describe("OutboundDeliveryService — ordem de entrega texto/mídia", () => {
  it("aguarda confirmação da mídia ANTES de enviar o texto seguinte", async () => {
    const events: string[] = [];
    const { service } = makeService({
      statusSequence: ["pending", "pending", "delivered"],
      events,
    });

    await service.deliver({
      to: "5511999999999",
      parts: makeParts(),
      config: zapiConfig,
      log: silentLog,
      sendText: async (content) => {
        events.push(`text:${content.slice(0, 20)}`);
        return { msgId: "txt-1", deliveryFormat: "text" };
      },
      onTextSent: async () => {},
      onMediaSent: async ({ part }) => {
        events.push(`persisted:${part.mediaId}`);
      },
    });

    // O segundo texto só pode aparecer DEPOIS da confirmação do primeiro vídeo
    const firstVideoConfirmed = events.indexOf("status_check:delivered");
    const secondText = events.findIndex((e) => e.startsWith("text:Sobre a Estrat"));
    expect(firstVideoConfirmed).toBeGreaterThan(-1);
    expect(secondText).toBeGreaterThan(firstVideoConfirmed);
  });

  it("entrega todas as partes na ordem original", async () => {
    const events: string[] = [];
    const { service } = makeService({ statusSequence: ["delivered"], events });

    const delivered: string[] = [];
    await service.deliver({
      to: "5511999999999",
      parts: makeParts(),
      config: zapiConfig,
      log: silentLog,
      sendText: async (content) => {
        delivered.push(`text:${content}`);
        return { msgId: null, deliveryFormat: "text" };
      },
      onTextSent: async () => {},
      onMediaSent: async ({ part }) => {
        delivered.push(`media:${part.mediaId}`);
      },
    });

    expect(delivered).toEqual([
      "text:Sobre a Simplificada...",
      "media:vid-simplificada",
      "text:Sobre a Estratificada...",
      "media:vid-estratificada",
    ]);
  });

  it("primeira parte de texto é marcada isFirst (atualiza a mensagem pré-salva)", async () => {
    const events: string[] = [];
    const { service } = makeService({ statusSequence: ["delivered"], events });

    const firstFlags: boolean[] = [];
    await service.deliver({
      to: "55119",
      parts: makeParts(),
      config: zapiConfig,
      log: silentLog,
      sendText: async () => ({ msgId: "m", deliveryFormat: "text" }),
      onTextSent: async ({ isFirst }) => {
        firstFlags.push(isFirst);
      },
      onMediaSent: async () => {},
    });

    expect(firstFlags).toEqual([true, false]);
  });

  it("degrada graciosamente: status 'unsupported' não trava a entrega", async () => {
    const events: string[] = [];
    const { service, statusCalls } = makeService({ statusSequence: ["unsupported"], events });

    const delivered: string[] = [];
    await service.deliver({
      to: "55119",
      parts: makeParts(),
      config: zapiConfig,
      log: silentLog,
      sendText: async (c) => {
        delivered.push(c);
        return { msgId: null, deliveryFormat: "text" };
      },
      onTextSent: async () => {},
      onMediaSent: async ({ part }) => {
        delivered.push(part.mediaId);
      },
    });

    expect(delivered).toHaveLength(4);
    // Uma checagem por mídia, sem insistir após "unsupported"
    expect(statusCalls).toHaveLength(2);
  });

  it("timeout de confirmação não bloqueia as partes seguintes", async () => {
    const events: string[] = [];
    const { service } = makeService({ statusSequence: ["pending"], events });

    const delivered: string[] = [];
    await service.deliver({
      to: "55119",
      parts: makeParts(),
      config: zapiConfig,
      log: silentLog,
      sendText: async (c) => {
        delivered.push(c);
        return { msgId: null, deliveryFormat: "text" };
      },
      onTextSent: async () => {},
      onMediaSent: async ({ part }) => {
        delivered.push(part.mediaId);
      },
    });

    expect(delivered).toHaveLength(4);
  });

  it("falha no envio de mídia não interrompe a entrega das demais partes", async () => {
    const events: string[] = [];
    let calls = 0;
    const { service } = makeService({
      statusSequence: ["delivered"],
      events,
      sendMediaImpl: async () => {
        calls++;
        if (calls === 1) throw new Error("Z-API 500");
        return "ok-2";
      },
    });

    const delivered: string[] = [];
    await service.deliver({
      to: "55119",
      parts: makeParts(),
      config: zapiConfig,
      log: silentLog,
      sendText: async (c) => {
        delivered.push(c);
        return { msgId: null, deliveryFormat: "text" };
      },
      onTextSent: async () => {},
      onMediaSent: async ({ part }) => {
        delivered.push(part.mediaId);
      },
    });

    // Primeiro vídeo falhou (não persistido); textos e segundo vídeo entregues
    expect(delivered).toEqual([
      "Sobre a Simplificada...",
      "Sobre a Estratificada...",
      "vid-estratificada",
    ]);
  });

  it("não consulta status quando msgId é null (envio desabilitado) ou provider não é z_api", async () => {
    const events: string[] = [];
    const { service, statusCalls } = makeService({
      statusSequence: ["delivered"],
      events,
      sendMediaImpl: async () => null,
    });

    await service.deliver({
      to: "55119",
      parts: makeParts(),
      config: zapiConfig,
      log: silentLog,
      sendText: async () => ({ msgId: null, deliveryFormat: "text" }),
      onTextSent: async () => {},
      onMediaSent: async () => {},
    });

    expect(statusCalls).toHaveLength(0);
  });
});
