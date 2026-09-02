/**
 * Tradução do webhook do WAHA para o evento de entrada canônico — ADR-010.
 *
 * O WAHA entrega `{ event, session, payload }` com o chatId no formato
 * `<numero>@c.us`. A sessão faz o papel que o instanceId faz na Z-API: é ela
 * que identifica o tenant e que escopa o alias de thread.
 */
import type { RecordInboundEventInput } from "@/application/ports/inbound-event-store";
import {
  buildContactIdentifiersFromWebhook,
  buildWhatsAppStreamAliases,
} from "@/core/whatsapp/WhatsAppContactIdentity";

export type WahaMedia = {
  url?: string | null;
  mimetype?: string | null;
  filename?: string | null;
};

export type WahaWebhookEvent = {
  event: string;
  session: string;
  payload: {
    id: string;
    timestamp: number;
    from: string;
    fromMe?: boolean;
    to?: string;
    body?: string;
    hasMedia?: boolean;
    media?: WahaMedia | null;
    _data?: { notifyName?: string } | null;
  };
};

/**
 * Um chatId do WAHA é `<identificador>@<dominio>`: `@c.us` para telefone,
 * `@lid` para o identificador opaco que o WhatsApp passou a emitir. Tratar
 * `@lid` como telefone criaria lead com "telefone" inexistente — foi
 * exatamente a classe de bug do upsert por LID.
 */
export function parseWahaContact(chatId: string): {
  phone: string | null;
  whatsappLid: string | null;
} {
  const [identifier, domain] = chatId.split("@");
  if (domain === "lid") return { phone: null, whatsappLid: identifier };
  return { phone: identifier, whatsappLid: null };
}

export function isWahaGroupOrStatusMessage(event: WahaWebhookEvent): boolean {
  const from = event.payload.from ?? "";
  return from.endsWith("@g.us") || from.startsWith("status@");
}

export function resolveWahaMediaType(mimetype: string | null | undefined): string | null {
  if (!mimetype) return null;
  const type = mimetype.split("/")[0]?.trim().toLowerCase();
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  return "document";
}

export function buildWahaInboundEvent(params: {
  clinicId: string;
  event: WahaWebhookEvent;
  now?: Date;
}): RecordInboundEventInput {
  const { clinicId, event } = params;
  const { payload, session } = event;

  const contact = parseWahaContact(payload.from);
  const identifiers = buildContactIdentifiersFromWebhook({
    phone: contact.phone,
    chatLid: contact.whatsappLid,
  });
  const conversationKey = contact.whatsappLid?.trim() || contact.phone || payload.from;

  const normalizedText = payload.body?.trim() || null;

  return {
    clinicId,
    provider: "waha",
    providerMessageId: payload.id,
    conversationKey,
    aliases: buildWhatsAppStreamAliases({
      provider: "waha",
      providerInstanceId: session,
      providerThreadId: conversationKey,
      phone: identifiers.phone,
      whatsappLid: identifiers.whatsappLid,
    }),
    payload,
    normalizedText,
    mediaType: payload.hasMedia ? resolveWahaMediaType(payload.media?.mimetype) : null,
    dedupeKey: `waha:${session}:${payload.id}`,
    // O WAHA entrega o timestamp da mensagem em SEGUNDOS (o do envelope é em
    // milissegundos). Tratar como ms jogaria a mensagem para 1970.
    receivedAt: payload.timestamp
      ? new Date(payload.timestamp * 1000)
      : (params.now ?? new Date()),
  };
}
