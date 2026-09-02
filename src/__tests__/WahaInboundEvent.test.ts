import { describe, expect, it } from "vitest";
import {
  buildWahaInboundEvent,
  isWahaGroupOrStatusMessage,
  parseWahaContact,
  resolveWahaMediaType,
  type WahaWebhookEvent,
} from "@/infrastructure/adapters/channels/whatsapp/waha-inbound-event";

const CLINIC_ID = "11111111-1111-1111-1111-111111111111";

function messageEvent(overrides: Partial<WahaWebhookEvent["payload"]> = {}): WahaWebhookEvent {
  return {
    event: "message",
    session: "vitalli",
    payload: {
      id: "false_5511999999999@c.us_ABCDEF",
      timestamp: 1667561485,
      from: "5511999999999@c.us",
      fromMe: false,
      to: "5511888888888@c.us",
      body: "Oi, queria saber o preço",
      hasMedia: false,
      ...overrides,
    },
  };
}

describe("parseWahaContact", () => {
  it("extrai o telefone de um chatId individual", () => {
    expect(parseWahaContact("5511999999999@c.us")).toEqual({
      phone: "5511999999999",
      whatsappLid: null,
    });
  });

  it("trata chatId @lid como identificador lid, não como telefone", () => {
    expect(parseWahaContact("123456789012345@lid")).toEqual({
      phone: null,
      whatsappLid: "123456789012345",
    });
  });
});

describe("isWahaGroupOrStatusMessage", () => {
  it("reconhece grupo pelo sufixo @g.us", () => {
    expect(isWahaGroupOrStatusMessage(messageEvent({ from: "12036304@g.us" }))).toBe(true);
  });

  it("reconhece broadcast de status", () => {
    expect(
      isWahaGroupOrStatusMessage(messageEvent({ from: "status@broadcast" })),
    ).toBe(true);
  });

  it("deixa passar conversa individual", () => {
    expect(isWahaGroupOrStatusMessage(messageEvent())).toBe(false);
  });
});

describe("resolveWahaMediaType", () => {
  it.each([
    ["image/jpeg", "image"],
    ["video/mp4", "video"],
    ["audio/ogg; codecs=opus", "audio"],
    ["application/pdf", "document"],
  ])("mapeia %s para %s", (mimetype, expected) => {
    expect(resolveWahaMediaType(mimetype)).toBe(expected);
  });

  it("devolve null quando não há mídia", () => {
    expect(resolveWahaMediaType(undefined)).toBeNull();
  });
});

describe("buildWahaInboundEvent", () => {
  it("marca o provider como waha, não como z_api", () => {
    const event = buildWahaInboundEvent({ clinicId: CLINIC_ID, event: messageEvent() });

    expect(event.provider).toBe("waha");
  });

  it("usa a sessão do WAHA como escopo da instância no alias de thread", () => {
    const event = buildWahaInboundEvent({ clinicId: CLINIC_ID, event: messageEvent() });

    expect(event.aliases).toContainEqual({
      kind: "provider_thread",
      providerScope: "waha:vitalli",
      normalizedValue: "5511999999999",
    });
  });

  it("registra o telefone como alias independente de provider", () => {
    const event = buildWahaInboundEvent({ clinicId: CLINIC_ID, event: messageEvent() });

    expect(event.aliases).toContainEqual(
      expect.objectContaining({ kind: "phone", normalizedValue: "5511999999999" }),
    );
  });

  it("deriva a dedupeKey da sessão e do id da mensagem", () => {
    const event = buildWahaInboundEvent({ clinicId: CLINIC_ID, event: messageEvent() });

    expect(event.dedupeKey).toBe("waha:vitalli:false_5511999999999@c.us_ABCDEF");
  });

  it("converte o timestamp em segundos do WAHA para Date", () => {
    const event = buildWahaInboundEvent({ clinicId: CLINIC_ID, event: messageEvent() });

    expect(event.receivedAt).toEqual(new Date(1667561485 * 1000));
  });

  it("normaliza o texto da mensagem", () => {
    const event = buildWahaInboundEvent({
      clinicId: CLINIC_ID,
      event: messageEvent({ body: "  Oi  " }),
    });

    expect(event.normalizedText).toBe("Oi");
  });

  it("classifica a mídia pelo mimetype do payload", () => {
    const event = buildWahaInboundEvent({
      clinicId: CLINIC_ID,
      event: messageEvent({
        body: "",
        hasMedia: true,
        media: { url: "https://waha.example.com/f.jpg", mimetype: "image/jpeg" },
      }),
    });

    expect(event.mediaType).toBe("image");
    expect(event.normalizedText).toBeNull();
  });
});
