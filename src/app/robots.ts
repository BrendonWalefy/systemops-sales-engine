import type { MetadataRoute } from "next";

/**
 * robots.txt para app.systemops.com.br
 *
 * Este é o painel SaaS (rotas protegidas por autenticação).
 * Não deve ser indexado pelo Google — o conteúdo público
 * está em systemops.com.br (systemops-landing).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
    // Referencia o sitemap da landing page para que rastreadores
    // encontrem o site público mesmo partindo deste domínio.
    sitemap: "https://systemops.com.br/sitemap.xml",
  };
}
