import { sendWhatsAppTextMessage } from "./whatsapp-channel-adapter";
import { sendZApiTextMessage } from "./zapi-channel-adapter";
import type { ClinicChannelConfig } from "./channel-config";

/**
 * Envia uma mensagem de texto pelo WhatsApp.
 *
 * Se `config` (credenciais da clínica) for fornecido, usa o provedor e as
 * credenciais DAQUELA clínica — garantindo isolamento entre tenants. Sem
 * config, cai no provedor/credenciais globais (env) da fase piloto.
 */
export async function sendTextMessage(
  to: string,
  text: string,
  config?: ClinicChannelConfig,
): Promise<string | null> {
  const provider = config?.provider ?? process.env.WHATSAPP_PROVIDER ?? "meta_cloud_api";

  if (provider === "z_api") {
    return sendZApiTextMessage(to, text, config?.zapi ?? undefined);
  }
  return sendWhatsAppTextMessage(to, text, config?.meta ?? undefined);
}
