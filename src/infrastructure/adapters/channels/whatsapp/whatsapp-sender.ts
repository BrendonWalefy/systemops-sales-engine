import { sendWhatsAppTextMessage } from "./whatsapp-channel-adapter";
import { sendZApiTextMessage } from "./zapi-channel-adapter";
import type { ClinicChannelConfig } from "./channel-config";

/**
 * Envia uma mensagem de texto pelo WhatsApp.
 *
 * Usa sempre o provedor e as credenciais DAQUELA clínica — garantindo
 * isolamento entre tenants.
 */
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
