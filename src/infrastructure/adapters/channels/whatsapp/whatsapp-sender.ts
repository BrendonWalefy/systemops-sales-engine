import { sendWhatsAppTextMessage } from "./whatsapp-channel-adapter";
import { sendZApiTextMessage, sendZApiMediaMessage, sendZApiButtonListMessage, sendZApiLinkMessage, type ZApiButton } from "./zapi-channel-adapter";
import { extractTrailingUrl } from "@/application/messaging/link-preview";
import { resolveLinkPreview } from "@/application/messaging/link-preview-cache";
import { shortenUrl } from "@/application/messaging/short-link";
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

    // Card de pré-visualização: o WhatsApp monta sozinho quando um humano digita,
    // mas a Z-API não — por isso o endereço enviado pelo sistema chegava como link
    // pelado. Só entra quando a mensagem TERMINA no link (exigência do send-link) e
    // quando a URL devolve título e imagem. Qualquer falha cai no texto puro, que é
    // o comportamento de sempre: card é ganho, nunca requisito para a mensagem sair.
    const trailingUrl = extractTrailingUrl(formatted);
    if (trailingUrl) {
      try {
        const preview = await resolveLinkPreview(trailingUrl);
        // Título basta. Testado em produção: sem `image` a Z-API aceita e o
        // WhatsApp desenha o card só com título, descrição e fonte — pior que o
        // card com foto, melhor que o link pelado. Exigir imagem faria links sem
        // og:image (o encurtado do Maps é um) regredirem para texto puro.
        if (preview?.title) {
          // O card já está resolvido a partir da URL ORIGINAL — encurtar depois
          // disso só troca o que o lead LÊ. É o que permite ter o texto de uma
          // linha E a foto grande: o link curto do Google devolve título mas não
          // devolve og:image, então encurtar nós mesmos é o único caminho para os
          // dois ao mesmo tempo.
          const shortUrl = await shortenUrl(trailingUrl);
          const messageText = shortUrl
            ? formatted.replace(trailingUrl, shortUrl)
            : formatted;

          return await sendZApiLinkMessage(
            to,
            messageText,
            {
              linkUrl: shortUrl ?? trailingUrl,
              title: preview.title,
              linkDescription: preview.description ?? "",
              image: preview.imageUrl ?? "",
            },
            config.zapi,
          );
        }
      } catch (error) {
        console.warn("[LinkPreview] falhou; enviando como texto puro", error);
      }
    }

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
  fileName?: string,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;

  const formattedCaption = caption ? toWhatsAppFormatting(caption) : caption;
  if (config.provider === "z_api") {
    if (!config.zapi) throw new Error("Z-API credentials are not configured for this clinic");
    return sendZApiMediaMessage(to, mediaUrl, mediaType, config.zapi, formattedCaption, fileName);
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
