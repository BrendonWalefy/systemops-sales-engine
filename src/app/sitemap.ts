import type { MetadataRoute } from "next";

/**
 * sitemap.xml para app.systemops.com.br
 *
 * O app SaaS tem rotas protegidas que não devem ser indexadas.
 * Retornamos uma lista vazia — o Google não precisa rastrear
 * nenhuma rota deste domínio.
 *
 * O sitemap público (landing page) está em:
 * https://systemops.com.br/sitemap.xml
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
