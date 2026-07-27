export type MetaInboundTextMessage = {
  phoneNumberId: string;
  phone: string;
  messageId: string;
  messageText: string;
  senderName: string | null;
  receivedAt: Date;
};

/** Extrai somente o formato Meta que o worker suporta hoje: mensagem de texto. */
export function parseMetaInboundTextMessage(payload: unknown): MetaInboundTextMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const entry = firstObject(body.entry);
  const change = firstObject(entry?.changes);
  const value = asObject(change?.value);
  const message = firstObject(value?.messages);
  const metadata = asObject(value?.metadata);
  if (!message || message.type !== "text") return null;
  const text = asObject(message.text);
  const contact = firstObject(value?.contacts);
  const profile = asObject(contact?.profile);

  const phoneNumberId = nonEmptyString(metadata?.phone_number_id);
  const phone = nonEmptyString(message.from);
  const messageId = nonEmptyString(message.id);
  const messageText = typeof text?.body === "string" ? text.body : "";
  if (!phoneNumberId || !phone || !messageId || !messageText.trim()) return null;

  const timestampSeconds = Number(message.timestamp);
  const receivedAt = Number.isFinite(timestampSeconds) && timestampSeconds > 0
    ? new Date(timestampSeconds * 1000)
    : new Date();
  return {
    phoneNumberId,
    phone,
    messageId,
    messageText,
    senderName: nonEmptyString(profile?.name),
    receivedAt,
  };
}

function firstObject(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) ? asObject(value[0]) : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
