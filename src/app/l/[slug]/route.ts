import { NextResponse } from "next/server";
import { resolveShortLink } from "@/application/messaging/short-link";

export const dynamic = "force-dynamic";

/**
 * Redirecionamento do link curto que sai nas mensagens do WhatsApp.
 *
 * Rota pública de propósito: quem clica é o lead, que não tem sessão. Não serve
 * meta tag e não precisa — o card do WhatsApp é montado pelo `send-link` com os
 * dados que resolvemos da URL original, antes do envio.
 *
 * 302 e não 301: destino errado cadastrado por engano ficaria preso no cache do
 * navegador do lead se fosse permanente.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const target = await resolveShortLink(slug);
  if (!target) {
    return NextResponse.json({ error: "Link não encontrado" }, { status: 404 });
  }
  return NextResponse.redirect(target, 302);
}
