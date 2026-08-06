import { describe, expect, it } from "vitest";
import {
  buildContactIdentifiersFromWebhook,
  isWhatsAppLid,
  mergeContactIdentifiers,
  normalizeManualWhatsAppPhone,
  parseWhatsAppContactField,
  resolveWhatsAppChannelAddress,
} from "@/core/whatsapp/WhatsAppContactIdentity";

describe("WhatsAppContactIdentity", () => {
  it("detecta @lid", () => {
    expect(isWhatsAppLid("200000000000002@lid")).toBe(true);
    expect(isWhatsAppLid("5511900000002")).toBe(false);
  });

  it("parseia telefone E.164", () => {
    expect(parseWhatsAppContactField("5511900000002")).toEqual({ phone: "5511900000002" });
    expect(parseWhatsAppContactField("+55 (11) 90000-0002")).toEqual({ phone: "5511900000002" });
  });

  it("normaliza WhatsApp digitado manualmente na agenda com DDI", () => {
    expect(normalizeManualWhatsAppPhone("(11) 99016-1996")).toBe("5511990161996");
    expect(normalizeManualWhatsAppPhone("5511990161996")).toBe("5511990161996");
    expect(normalizeManualWhatsAppPhone("+1 415 555 2671")).toBe("14155552671");
    expect(normalizeManualWhatsAppPhone("1234")).toBeNull();
  });

  it("parseia @lid sem colocar em phone", () => {
    expect(parseWhatsAppContactField("200000000000002@lid")).toEqual({
      whatsappLid: "200000000000002@lid",
    });
  });

  it("combina phone e chatLid do webhook", () => {
    expect(
      buildContactIdentifiersFromWebhook({
        phone: "5511900000002",
        chatLid: "200000000000002@lid",
      }),
    ).toEqual({
      phone: "5511900000002",
      whatsappLid: "200000000000002@lid",
    });
  });

  it("quando phone do webhook é @lid, usa chatLid se vier número", () => {
    expect(
      buildContactIdentifiersFromWebhook({
        phone: "200000000000002@lid",
        chatLid: "200000000000002@lid",
      }),
    ).toEqual({
      phone: null,
      whatsappLid: "200000000000002@lid",
    });
  });

  it("resolve endereço de envio preferindo telefone", () => {
    expect(
      resolveWhatsAppChannelAddress(
        mergeContactIdentifiers(
          { phone: "5511900000002" },
          { whatsappLid: "200000000000002@lid" },
        ),
      ),
    ).toBe("5511900000002");

    expect(
      resolveWhatsAppChannelAddress({ phone: null, whatsappLid: "200000000000002@lid" }),
    ).toBe("200000000000002@lid");
  });
});
