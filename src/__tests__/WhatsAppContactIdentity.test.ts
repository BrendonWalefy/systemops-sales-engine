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
    expect(isWhatsAppLid("271295921025045@lid")).toBe(true);
    expect(isWhatsAppLid("5511979663668")).toBe(false);
  });

  it("parseia telefone E.164", () => {
    expect(parseWhatsAppContactField("5511979663668")).toEqual({ phone: "5511979663668" });
    expect(parseWhatsAppContactField("+55 (11) 97966-3668")).toEqual({ phone: "5511979663668" });
  });

  it("normaliza WhatsApp digitado manualmente na agenda com DDI", () => {
    expect(normalizeManualWhatsAppPhone("(11) 99016-1996")).toBe("5511990161996");
    expect(normalizeManualWhatsAppPhone("5511990161996")).toBe("5511990161996");
    expect(normalizeManualWhatsAppPhone("+1 415 555 2671")).toBe("14155552671");
    expect(normalizeManualWhatsAppPhone("1234")).toBeNull();
  });

  it("parseia @lid sem colocar em phone", () => {
    expect(parseWhatsAppContactField("271295921025045@lid")).toEqual({
      whatsappLid: "271295921025045@lid",
    });
  });

  it("combina phone e chatLid do webhook", () => {
    expect(
      buildContactIdentifiersFromWebhook({
        phone: "5511979663668",
        chatLid: "271295921025045@lid",
      }),
    ).toEqual({
      phone: "5511979663668",
      whatsappLid: "271295921025045@lid",
    });
  });

  it("quando phone do webhook é @lid, usa chatLid se vier número", () => {
    expect(
      buildContactIdentifiersFromWebhook({
        phone: "271295921025045@lid",
        chatLid: "271295921025045@lid",
      }),
    ).toEqual({
      phone: null,
      whatsappLid: "271295921025045@lid",
    });
  });

  it("resolve endereço de envio preferindo telefone", () => {
    expect(
      resolveWhatsAppChannelAddress(
        mergeContactIdentifiers(
          { phone: "5511979663668" },
          { whatsappLid: "271295921025045@lid" },
        ),
      ),
    ).toBe("5511979663668");

    expect(
      resolveWhatsAppChannelAddress({ phone: null, whatsappLid: "271295921025045@lid" }),
    ).toBe("271295921025045@lid");
  });
});
