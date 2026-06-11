import { describe, expect, it } from "vitest";

import { isInternalOperationalWhatsAppMessage } from "@/core/whatsapp/InternalWhatsAppOperationalMessage";

describe("Internal WhatsApp operational message filter", () => {
  it("ignora alerta interno quando o remetente e o telefone da recepção coincidem", () => {
    expect(
      isInternalOperationalWhatsAppMessage({
        senderPhone: "5511940617713",
        receptionistPhone: "(11) 94061-7713",
        messageText: "⚠️ *Fulano precisa de você*\n\nPrecisa de atendimento humano.\n\nAcesse o Inbox para responder.",
      }),
    ).toBe(true);
  });

  it("ignora contexto interno de encaminhamento de mídia mesmo com acentuação removida no echo", () => {
    expect(
      isInternalOperationalWhatsAppMessage({
        senderPhone: "5511940617713",
        receptionistPhone: "5511940617713",
        messageText:
          "📎 *Maria* enviou uma foto para avaliacao.\n\nResponda neste chat - sua resposta sera encaminhada automaticamente ao lead.",
      }),
    ).toBe(true);
  });

  it("não bloqueia mensagem real do operador no mesmo número da recepção", () => {
    expect(
      isInternalOperationalWhatsAppMessage({
        senderPhone: "5511940617713",
        receptionistPhone: "5511940617713",
        messageText: "Pode vir amanhã às 14h que te esperamos aqui.",
      }),
    ).toBe(false);
  });

  it("não bloqueia alerta parecido vindo de outro número", () => {
    expect(
      isInternalOperationalWhatsAppMessage({
        senderPhone: "5511999999999",
        receptionistPhone: "5511940617713",
        messageText: "Fulano precisa de voce. Acesse o Inbox para responder.",
      }),
    ).toBe(false);
  });
});
