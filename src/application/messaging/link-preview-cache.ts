import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { linkPreviews } from "@/infrastructure/db/schema";
import { fetchLinkPreview, isFetchableUrl, type LinkPreview } from "./link-preview";

/**
 * Sucesso vale 7 dias. Não é arbitrário: a `og:image` que o Google devolve para
 * um lugar do Maps é uma URL assinada de `lh3.googleusercontent.com`, que expira.
 * Reexpirar o cache antes disso é o que impede o card de virar uma faixa sem foto
 * semanas depois, silenciosamente. Copiar a imagem para o nosso blob resolveria de
 * vez, ao custo de mais um ciclo de vida de arquivo para manter — se a foto quebrar
 * mesmo com o TTL, é esse o próximo passo.
 */
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Falha vale pouco: site fora do ar volta, e não queremos tentar a cada mensagem. */
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;

function isFresh(fetchedAt: Date, ok: boolean, now: Date): boolean {
  const age = now.getTime() - fetchedAt.getTime();
  return age < (ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS);
}

/**
 * Prévia da URL, do cache quando fresca. `null` = não há card para esta URL (site
 * sem Open Graph, fora do ar, ou endereço não buscável) — o chamador manda texto
 * puro, que é o comportamento de hoje.
 */
export async function resolveLinkPreview(
  url: string,
  now: Date = new Date(),
): Promise<LinkPreview | null> {
  if (!isFetchableUrl(url)) return null;

  const [cached] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, url)).limit(1);
  if (cached && isFresh(cached.fetchedAt, cached.ok, now)) {
    if (!cached.ok || !cached.title) return null;
    return {
      url,
      title: cached.title,
      description: cached.description,
      imageUrl: cached.imageUrl,
    };
  }

  const fresh = await fetchLinkPreview(url);

  await db
    .insert(linkPreviews)
    .values({
      url,
      title: fresh?.title ?? null,
      description: fresh?.description ?? null,
      imageUrl: fresh?.imageUrl ?? null,
      ok: fresh !== null,
      fetchedAt: now,
    })
    .onConflictDoUpdate({
      target: linkPreviews.url,
      set: {
        title: fresh?.title ?? null,
        description: fresh?.description ?? null,
        imageUrl: fresh?.imageUrl ?? null,
        ok: fresh !== null,
        fetchedAt: now,
      },
    });

  return fresh;
}
