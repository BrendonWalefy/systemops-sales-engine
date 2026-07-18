import { sendWhatsAppTextMessage } from "./whatsapp-channel-adapter";
import { sendZApiTextMessage, sendZApiMediaMessage, sendZApiButtonListMessage, type ZApiButton } from "./zapi-channel-adapter";
import type { ClinicChannelConfig } from "./channel-config";
import type { MediaType } from "@/application/ports/channel-adapter";

// WhatsApp usa *negrito* com um asterisco; o LLM às vezes emite markdown
// (**negrito**), que o WhatsApp renderiza como asteriscos literais.
export function toWhatsAppFormatting(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

export async function sendTextMessage(
  to: string,
  text: string,
  config: ClinicChannelConfig,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;

  const formatted = toWhatsAppFormatting(text);
  if (config.provider === "z_api") {
    if (!config.zapi) throw new Error("Z-API credentials are not configured for this clinic");
    return sendZApiTextMessage(to, formatted, config.zapi);
  }
  if (!config.meta) throw new Error("Meta WhatsApp credentials are not configured for this clinic");
  return sendWhatsAppTextMessage(to, formatted, config.meta);
}

export async function sendMediaMessage(
  to: string,
  mediaUrl: string,
  mediaType: MediaType,
  config: ClinicChannelConfig,
  caption?: string,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;

  const formattedCaption = caption ? toWhatsAppFormatting(caption) : caption;
  if (config.provider === "z_api") {
    if (!config.zapi) throw new Error("Z-API credentials are not configured for this clinic");
    return sendZApiMediaMessage(to, mediaUrl, mediaType, config.zapi, formattedCaption);
  }
  // Meta Cloud API — upload via media_id not yet implemented; fall back to caption link
  if (!config.meta) throw new Error("Meta WhatsApp credentials are not configured for this clinic");
  const text = formattedCaption ? `${formattedCaption}\n${mediaUrl}` : mediaUrl;
  return sendWhatsAppTextMessage(to, text, config.meta);
}

export async function sendButtonListMessage(
  to: string,
  text: string,
  buttons: ZApiButton[],
  config: ClinicChannelConfig,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;

  const formatted = toWhatsAppFormatting(text);
  if (config.provider === "z_api") {
    if (!config.zapi) throw new Error("Z-API credentials are not configured for this clinic");
    return sendZApiButtonListMessage(to, formatted, buttons, config.zapi);
  }

  const fallback = [
    formatted,
    "",
    ...buttons.map((button) => `${button.id} — ${button.label}`),
  ].join("\n");
  if (!config.meta) throw new Error("Meta WhatsApp credentials are not configured for this clinic");
  return sendWhatsAppTextMessage(to, fallback, config.meta);
}
