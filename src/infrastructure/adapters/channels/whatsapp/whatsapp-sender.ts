import { sendWhatsAppTextMessage } from "./whatsapp-channel-adapter";
import { sendZApiTextMessage } from "./zapi-channel-adapter";

/**
 * Sends a WhatsApp text message using the configured provider.
 * Set WHATSAPP_PROVIDER=z_api to use Z-API, otherwise uses Meta Cloud API.
 */
export async function sendTextMessage(to: string, text: string): Promise<string | null> {
  const provider = process.env.WHATSAPP_PROVIDER ?? "meta_cloud_api";

  if (provider === "z_api") {
    return sendZApiTextMessage(to, text);
  } else {
    return sendWhatsAppTextMessage(to, text);
  }
}
