import { createHmac, timingSafeEqual } from "node:crypto";

export function extractMetaPhoneNumberId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const entry = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entry)) return null;
  for (const item of entry) {
    if (!item || typeof item !== "object") continue;
    const changes = (item as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const value = (change as { value?: unknown }).value;
      if (!value || typeof value !== "object") continue;
      const metadata = (value as { metadata?: unknown }).metadata;
      if (!metadata || typeof metadata !== "object") continue;
      const phoneNumberId = (metadata as { phone_number_id?: unknown }).phone_number_id;
      if (typeof phoneNumberId === "string" && phoneNumberId.trim()) {
        return phoneNumberId.trim();
      }
    }
  }
  return null;
}

export function verifyMetaWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}): boolean {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(input.signatureHeader ?? "");
  if (!match || !input.appSecret) return false;
  const expected = createHmac("sha256", input.appSecret)
    .update(input.rawBody, "utf8")
    .digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
