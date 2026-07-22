import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { shortLinks } from "@/infrastructure/db/schema";
import { isFetchableUrl } from "./link-preview";

/**
 * Encurtador de link para as mensagens do WhatsApp.
 *
 * O WhatsApp SEMPRE mostra a URL por escrito — não existe texto com link
 * embutido. O link do Google Maps que o operador usa tem 180 caracteres e ocupa
 * cinco linhas embaixo do card. Encurtando, sobra uma linha.
 *
 * O card não depende deste encurtador: quem fornece título, descrição e imagem
 * para a Z-API somos nós, resolvidos a partir da URL ORIGINAL. Este módulo só
 * troca o que o lead LÊ. Por isso a rota de redirecionamento pode ser um 302
 * simples — não precisa servir meta tag nenhuma.
 */

const SLUG_LENGTH = 7;
/** Abaixo disso encurtar não compensa: troca uma URL legível por uma opaca. */
export const SHORTEN_THRESHOLD = 60;

/**
 * Slug determinístico a partir da URL: a mesma URL sempre gera o mesmo slug, o
 * que torna a criação idempotente e evita encher a tabela de duplicatas quando o
 * mesmo endereço é enviado centenas de vezes.
 */
export function slugForUrl(url: string): string {
  return createHash("sha256").update(url).digest("base64url").slice(0, SLUG_LENGTH);
}

export function shouldShorten(url: string): boolean {
  return url.length > SHORTEN_THRESHOLD && isFetchableUrl(url);
}

export function shortLinkBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.systemops.com.br";
}

export function buildShortUrl(slug: string): string {
  return `${shortLinkBaseUrl().replace(/\/$/, "")}/l/${slug}`;
}

/**
 * Devolve a URL curta equivalente, criando o registro se ainda não existir.
 * Devolve `null` quando não vale encurtar — o chamador segue com a URL original.
 */
export async function shortenUrl(url: string): Promise<string | null> {
  if (!shouldShorten(url)) return null;

  const slug = slugForUrl(url);
  await db
    .insert(shortLinks)
    .values({ slug, targetUrl: url })
    // Colisão só acontece com a MESMA url (slug é derivado dela), então não há o
    // que atualizar — o registro existente já aponta para o destino certo.
    .onConflictDoNothing({ target: shortLinks.slug });

  return buildShortUrl(slug);
}

export async function resolveShortLink(slug: string): Promise<string | null> {
  const [row] = await db.select().from(shortLinks).where(eq(shortLinks.slug, slug)).limit(1);
  if (!row) return null;
  // Revalida na leitura: se a linha foi adulterada no banco, não viramos um
  // redirecionador aberto para qualquer destino.
  return isFetchableUrl(row.targetUrl) ? row.targetUrl : null;
}
