import { sendWhatsAppTextMessage } from "./whatsapp-channel-adapter";
import { sendZApiTextMessage, sendZApiMediaMessage, sendZApiButtonListMessage, sendZApiLinkMessage, type ZApiButton } from "./zapi-channel-adapter";
import { sendWahaTextMessage, sendWahaMediaMessage } from "./waha-channel-adapter";
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

/**
 * Roteamento por provider.
 *
 * O padrão anterior era `if (provider === "z_api") { ... }` com todo o resto
 * caindo IMPLICITAMENTE na Meta. Qualquer provider novo — WAHA incluso — era
 * enviado para a Meta e estourava "Meta credentials are not configured":
 * falha na ativação do tenant, não no teste. O despacho agora é explícito e
 * um provider desconhecido falha dizendo o próprio nome.
 */
function unsupportedProvider(provider: never): Error {
  return new Error(`Provedor de WhatsApp não suportado: ${String(provider)}`);
}

function requireZapi(config: ClinicChannelConfig) {
  if (!config.zapi) throw new Error("Z-API credentials are not configured for this clinic");
  return config.zapi;
}

function requireMeta(config: ClinicChannelConfig) {
  if (!config.meta) throw new Error("Meta WhatsApp credentials are not configured for this clinic");
  return config.meta;
}

function requireWaha(config: ClinicChannelConfig) {
  if (!config.waha) throw new Error("WAHA credentials are not configured for this clinic");
  return config.waha;
}

export async function sendTextMessage(
  to: string,
  text: string,
  config: ClinicChannelConfig,
  onProviderBoundaryEntered?: () => void,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;
  let providerBoundaryEntered = false;
  const markProviderBoundaryEntered = () => {
    providerBoundaryEntered = true;
    onProviderBoundaryEntered?.();
  };

  const formatted = toWhatsAppFormatting(text);

  switch (config.provider) {
    case "z_api": {
      const zapi = requireZapi(config);

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

            markProviderBoundaryEntered();
            return await sendZApiLinkMessage(
              to,
              messageText,
              {
                linkUrl: shortUrl ?? trailingUrl,
                title: preview.title,
                linkDescription: preview.description ?? "",
                image: preview.imageUrl ?? "",
              },
              zapi,
            );
          }
        } catch (error) {
          if (providerBoundaryEntered) throw error;
          console.warn("[LinkPreview] falhou; enviando como texto puro", error);
        }
      }

      markProviderBoundaryEntered();
      return sendZApiTextMessage(to, formatted, zapi);
    }

    // WAHA não tem endpoint de card de link: o texto sai puro e o WhatsApp
    // decide sozinho se desenha a prévia. Perde-se o card garantido da Z-API,
    // nunca a mensagem.
    case "waha": {
      const waha = requireWaha(config);
      markProviderBoundaryEntered();
      return sendWahaTextMessage(to, formatted, waha);
    }

    case "meta_cloud_api": {
      const meta = requireMeta(config);
      markProviderBoundaryEntered();
      return sendWhatsAppTextMessage(to, formatted, meta);
    }

    default:
      throw unsupportedProvider(config.provider);
  }
}

export async function sendMediaMessage(
  to: string,
  mediaUrl: string,
  mediaType: MediaType,
  config: ClinicChannelConfig,
  caption?: string,
  fileName?: string,
  onProviderBoundaryEntered?: () => void,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;

  const formattedCaption = caption ? toWhatsAppFormatting(caption) : caption;

  switch (config.provider) {
    case "z_api": {
      const zapi = requireZapi(config);
      onProviderBoundaryEntered?.();
      return sendZApiMediaMessage(to, mediaUrl, mediaType, zapi, formattedCaption, fileName);
    }

    case "waha": {
      const waha = requireWaha(config);
      onProviderBoundaryEntered?.();
      return sendWahaMediaMessage(to, mediaUrl, mediaType, waha, formattedCaption, fileName);
    }

    case "meta_cloud_api": {
      // Meta Cloud API — upload via media_id not yet implemented; fall back to caption link
      const meta = requireMeta(config);
      const text = formattedCaption ? `${formattedCaption}\n${mediaUrl}` : mediaUrl;
      onProviderBoundaryEntered?.();
      return sendWhatsAppTextMessage(to, text, meta);
    }

    default:
      throw unsupportedProvider(config.provider);
  }
}

/** Lista numerada — o degrade de botões usado por todo provider sem botão nativo. */
function buildButtonFallbackText(text: string, buttons: ZApiButton[]): string {
  return [text, "", ...buttons.map((button) => `${button.id} — ${button.label}`)].join("\n");
}

export async function sendButtonListMessage(
  to: string,
  text: string,
  buttons: ZApiButton[],
  config: ClinicChannelConfig,
): Promise<string | null> {
  if (process.env.DISABLE_REAL_WHATSAPP_SEND === "true") return null;

  const formatted = toWhatsAppFormatting(text);

  switch (config.provider) {
    case "z_api":
      return sendZApiButtonListMessage(to, formatted, buttons, requireZapi(config));

    // A engine GOWS não entrega botões interativos de forma confiável; mandar
    // como texto numerado é o que o parser de resposta já entende.
    case "waha":
      return sendWahaTextMessage(
        to,
        buildButtonFallbackText(formatted, buttons),
        requireWaha(config),
      );

    case "meta_cloud_api":
      return sendWhatsAppTextMessage(
        to,
        buildButtonFallbackText(formatted, buttons),
        requireMeta(config),
      );

    default:
      throw unsupportedProvider(config.provider);
  }
}
