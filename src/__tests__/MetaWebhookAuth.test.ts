import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractMetaPhoneNumberId,
  verifyMetaWebhookSignature,
} from "@/application/whatsapp/meta-webhook-auth";

describe("Meta webhook authentication", () => {
  it("extrai o phone_number_id também de status updates", () => {
    expect(extractMetaPhoneNumberId({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: " 123456 " },
        statuses: [{ id: "wamid.status" }],
      } }] }],
    })).toBe("123456");
  });

  it("valida HMAC sobre os bytes exatos do corpo", () => {
    const rawBody = '{"entry":[]}\n';
    const appSecret = "app-secret";
    const signatureHeader = `sha256=${createHmac("sha256", appSecret)
      .update(rawBody)
      .digest("hex")}`;

    expect(verifyMetaWebhookSignature({ rawBody, signatureHeader, appSecret })).toBe(true);
    expect(verifyMetaWebhookSignature({
      rawBody: rawBody.trim(),
      signatureHeader,
      appSecret,
    })).toBe(false);
  });

  it("rejeita formato inválido sem lançar", () => {
    expect(verifyMetaWebhookSignature({
      rawBody: "{}",
      signatureHeader: "sha256=xyz",
      appSecret: "secret",
    })).toBe(false);
  });
});
