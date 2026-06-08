import { sendWhatsAppTextMessage } from "./whatsapp-channel-adapter";
import { sendZApiTextMessage, sendZApiMediaMessage } from "./zapi-channel-adapter";
import type { ClinicChannelConfig } from "./channel-config";
import type { MediaType } from "@/application/ports/channel-adapter";

export async function sendTextMessage(
  to: string,
  text: string,
  config: ClinicChannelConfig,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;

  if (config.provider === "z_api") {
    if (!config.zapi) throw new Error("Z-API credentials are not configured for this clinic");
    return sendZApiTextMessage(to, text, config.zapi);
  }
  if (!config.meta) throw new Error("Meta WhatsApp credentials are not configured for this clinic");
  return sendWhatsAppTextMessage(to, text, config.meta);
}

export async function sendMediaMessage(
  to: string,
  mediaUrl: string,
  mediaType: MediaType,
  config: ClinicChannelConfig,
  caption?: string,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;

  if (config.provider === "z_api") {
    if (!config.zapi) throw new Error("Z-API credentials are not configured for this clinic");
    return sendZApiMediaMessage(to, mediaUrl, mediaType, config.zapi, caption);
  }
  // Meta Cloud API — upload via media_id not yet implemented; fall back to caption link
  if (!config.meta) throw new Error("Meta WhatsApp credentials are not configured for this clinic");
  const text = caption ? `${caption}\n${mediaUrl}` : mediaUrl;
  return sendWhatsAppTextMessage(to, text, config.meta);
}
