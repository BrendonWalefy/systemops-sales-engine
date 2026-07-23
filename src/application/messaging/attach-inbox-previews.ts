import { inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { linkPreviews, shortLinks } from "@/infrastructure/db/schema";
import { extractTrailingUrl } from "./link-preview";

/**
 * Espelha no inbox o card que o WhatsApp desenha para o lead.
 *
 * A mensagem é guardada como texto puro — o card não é arquivo nosso, é um desenho
 * que o app do lead monta. Mas a gente JÁ resolveu e guardou título/descrição/foto
 * na tabela `link_previews` na hora do envio. Aqui só lemos esse cache e anexamos,
 * para o operador ver o mesmo cartão.
 *
 * Reconstrói o caminho do envio ao contrário: o texto pode terminar num link curto
 * (`/l/slug`), e o cache é indexado pela URL ORIGINAL — então resolvemos o slug de
 * volta antes de procurar a prévia. Tudo em duas queries em lote, sem N+1.
 */
export type InboxLinkPreview = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
};

export type WithPreview<T> = T & { linkPreview?: InboxLinkPreview | null };

function slugFromShortUrl(url: string): string | null {
  const match = url.match(/\/l\/([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

export async function attachInboxPreviews<T extends { body: string; mediaUrl?: string | null; mediaType?: string | null }>(
  msgs: T[],
): Promise<WithPreview<T>[]> {
  try {
    return await attachInboxPreviewsUnsafe(msgs);
  } catch (error) {
    // O card é um enfeite — nunca pode derrubar o carregamento das mensagens.
    // Falhou o cache/banco? Devolve o inbox exatamente como é hoje.
    console.warn("[InboxPreview] falhou; mensagens seguem sem card", error);
    return msgs.map((m) => ({ ...m }));
  }
}

async function attachInboxPreviewsUnsafe<T extends { body: string; mediaUrl?: string | null; mediaType?: string | null }>(
  msgs: T[],
): Promise<WithPreview<T>[]> {
  // Só mensagens de texto que terminam em link são candidatas — mídia já tem seu
  // próprio card, e link no meio do texto o WhatsApp não vira prévia.
  const trailing = new Map<T, string>();
  for (const m of msgs) {
    if (m.mediaUrl && m.mediaType) continue;
    const url = extractTrailingUrl(m.body);
    if (url) trailing.set(m, url);
  }
  if (trailing.size === 0) return msgs.map((m) => ({ ...m }));

  // Passo 1: os que são link curto → resolve o slug de volta para a URL original.
  const slugs = [...new Set([...trailing.values()].map(slugFromShortUrl).filter((s): s is string => s !== null))];
  const slugToTarget = new Map<string, string>();
  if (slugs.length > 0) {
    const rows = await db.select().from(shortLinks).where(inArray(shortLinks.slug, slugs));
    for (const r of rows) slugToTarget.set(r.slug, r.targetUrl);
  }

  // A URL efetiva de cada mensagem: a original quando é link curto, senão ela mesma.
  const effectiveUrl = new Map<T, string>();
  for (const [m, url] of trailing) {
    const slug = slugFromShortUrl(url);
    effectiveUrl.set(m, slug ? slugToTarget.get(slug) ?? url : url);
  }

  // Passo 2: busca as prévias em cache pelas URLs efetivas.
  const wanted = [...new Set(effectiveUrl.values())];
  const previewByUrl = new Map<string, InboxLinkPreview>();
  if (wanted.length > 0) {
    const rows = await db.select().from(linkPreviews).where(inArray(linkPreviews.url, wanted));
    for (const r of rows) {
      if (!r.ok || !r.title) continue;
      previewByUrl.set(r.url, {
        url: r.url,
        title: r.title,
        description: r.description,
        imageUrl: r.imageUrl,
      });
    }
  }

  return msgs.map((m) => {
    const url = effectiveUrl.get(m);
    const preview = url ? previewByUrl.get(url) ?? null : null;
    return preview ? { ...m, linkPreview: preview } : { ...m };
  });
}
