/**
 * Pré-visualização de link — o que o WhatsApp faz, feito por nós.
 *
 * No WhatsApp quem monta o card é o aplicativo de QUEM ENVIA: ele busca a página,
 * lê as meta tags Open Graph e embute título/descrição/miniatura na mensagem. Quem
 * recebe só desenha o que veio pronto. A Z-API não faz esse passo — o `send-text`
 * não tem parâmetro de prévia — então o link saía pelado (medido em produção:
 * endereço da Ximendes enviado pelo sistema chegou sem card).
 *
 * O `send-link` da Z-API aceita o card, mas exige que NÓS forneçamos title,
 * description e image. É isso que este módulo resolve.
 *
 * Detalhe que decide o desenho: o Google só serve as tags ricas para robô de
 * pré-visualização. Com user-agent de navegador, `og:title` do mesmo link volta
 * como "Google Maps"; com user-agent de bot, volta
 * "Helbor Offices São Paulo II · Av. Adolfo Pinheiro, 1.029 …" e uma foto real.
 * Por isso nos identificamos como bot de preview — não é disfarce, é o que somos.
 */

const PREVIEW_USER_AGENT =
  "Mozilla/5.0 (compatible; SystemOpsBot/1.0; +https://systemops.com.br) facebookexternalhit/1.1";

const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_REDIRECTS = 5;
/** URL longa demais não vira chave de cache nem vale o custo da busca. */
const MAX_URL_LENGTH = 1000;

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

/**
 * A Z-API exige que "o link seja informado no final desta mensagem" para montar o
 * card. Em vez de reordenar a prosa da IA — que mudaria o texto que o lead lê —
 * só usamos o card quando a mensagem JÁ termina no link. Quando não termina, o
 * envio segue como texto puro, exatamente como hoje.
 */
export function extractTrailingUrl(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/(https?:\/\/[^\s<>"]+)$/);
  if (!match) return null;
  const url = match[1].replace(/[.,;:!?)\]]+$/, "");
  return isFetchableUrl(url) ? url : null;
}

/**
 * Só http(s), e nunca endereço interno. As URLs daqui vêm da IA ou do operador,
 * nunca do lead — mas o custo de fechar isso agora é uma função, e o de descobrir
 * depois que o servidor busca `http://169.254.169.254` é outro.
 */
export function isFetchableUrl(raw: string): boolean {
  if (raw.length > MAX_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (host === "metadata.google.internal") return false;

  // IP literal em faixa privada / loopback / link-local
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }
  if (host === "::1" || host.startsWith("[")) return false;

  return true;
}

/**
 * Entidades HTML, incluindo as NUMÉRICAS.
 *
 * As numéricas não são detalhe: o Instagram serve o título inteiro assim
 * (`v&#xed;deos`, `&#064;clinicavitalli`). Sem decodificar, o card chega ao lead
 * com `&#xed;` literal no meio da palavra — descoberto puxando o link de verdade,
 * não pelo teste com HTML que eu mesmo escrevi.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Lê uma meta tag aceitando as duas ordens de atributo — `property` antes de
 * `content` e o contrário. O Google devolve `content` primeiro, e um regex que só
 * cobrisse a ordem canônica não acharia nada justamente no caso que motivou isto.
 */
function readMetaTag(html: string, names: string[]): string | null {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
    ];
    for (const pattern of patterns) {
      const found = html.match(pattern);
      if (found?.[1]?.trim()) return decodeEntities(found[1].trim());
    }
  }
  return null;
}

export function parseLinkPreviewHtml(html: string, url: string): LinkPreview {
  const title =
    readMetaTag(html, ["og:title", "twitter:title"]) ??
    html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1]?.trim() ??
    null;
  const description = readMetaTag(html, ["og:description", "twitter:description", "description"]);
  const imageUrl = readMetaTag(html, ["og:image:secure_url", "og:image", "twitter:image"]);

  return {
    url,
    title: title ? decodeEntities(title) : null,
    description,
    imageUrl: imageUrl && isFetchableUrl(imageUrl) ? imageUrl : null,
  };
}

/** Busca a página e extrai o card. `null` quando não dá para montar nada útil. */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!isFetchableUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": PREVIEW_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const preview = parseLinkPreviewHtml(html, url);
    // Sem título não existe card: o WhatsApp mostraria uma faixa vazia.
    return preview.title ? preview : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const LINK_PREVIEW_LIMITS = {
  FETCH_TIMEOUT_MS,
  MAX_HTML_BYTES,
  MAX_REDIRECTS,
  MAX_URL_LENGTH,
} as const;
