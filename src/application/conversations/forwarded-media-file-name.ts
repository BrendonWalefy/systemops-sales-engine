/**
 * Nome do arquivo encaminhado ao WhatsApp do doutor.
 *
 * O encaminhamento chamava `sendMediaMessage` sem `fileName` — parâmetro que já
 * existia e nunca era usado. Resultado real (Vitalli, 21/07): o comprovante da
 * paciente chegou como `[documento] Sem nome` e **não abriu**. O mesmo arquivo
 * com nome abriu normalmente.
 *
 * Formato: `paciente_contexto_data.ext` — pedido do cliente em 21/07, para que o
 * doutor identifique o arquivo sem abrir a conversa.
 */

const EXTENSAO_POR_TIPO: Record<string, string> = {
  image: "jpg",
  video: "mp4",
  document: "pdf",
  audio: "ogg",
};

// Acentos fora, espaços viram "-", pontuação some. Nome de arquivo atravessa
// sistema de arquivos, header HTTP e cliente de WhatsApp — o que sobreviver a
// todos é o denominador comum.
function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function buildForwardedMediaFileName(params: {
  leadName: string | null | undefined;
  contextLabel: string | null | undefined;
  mediaType: string;
  now?: Date;
}): string {
  const data = (params.now ?? new Date()).toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
  const partes = [slug(params.leadName ?? "paciente"), slug(params.contextLabel ?? ""), data]
    .filter((p) => p.length > 0);
  const extensao = EXTENSAO_POR_TIPO[params.mediaType] ?? "bin";
  return `${partes.join("_")}.${extensao}`;
}
