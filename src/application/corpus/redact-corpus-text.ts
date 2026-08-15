/**
 * Segunda barreira de PII, aplicada ao texto que vai para dentro do repositório.
 *
 * A primeira barreira é `sanitizeReplayText`, escrita para artefatos de replay
 * que ficam fora do Git. Esta existe porque o corpus rotulado **é commitado**, e
 * o que passa aqui fica no histórico para sempre.
 *
 * Cada regra abaixo cobre uma forma que passou pela primeira barreira numa
 * extração real de 7.720 turnos:
 *
 * - nome de terceiro dentro de nome de arquivo (`Certidao_Nascimento_Fulano.pdf`)
 *   — sem espaço e sem título profissional, os detectores de nome não alcançam;
 * - payload de Pix copia-e-cola, que carrega domínio de banco, UUID e
 *   identificador do recebedor num bloco contínuo;
 * - UUID grudado em outros dígitos, que escapa de `\b` no fim do padrão;
 * - domínio sem esquema, que escapa de um detector que exige `http(s)://`.
 */

// Payload de pagamento: bloco longo, contínuo, majoritariamente numérico. Vem
// antes das demais para engolir o Pix inteiro em vez de fatiá-lo.
//
// O padrão é deliberadamente plano — sem quantificador aninhado. A primeira
// versão era `(?:\d[0-9a-z.\-/:]*){40,}`, que faz backtracking catastrófico e
// travou a suíte: dois quantificadores encaixados sobre alfabetos que se
// sobrepõem. A contagem de dígitos fica em código, onde é linear e legível.
const PAYMENT_CANDIDATE_RE = /[0-9a-z.\-/:]{40,}/gi;
const DIGITS_RE = /\d/g;

function isPaymentPayload(candidate: string): boolean {
  return (candidate.match(DIGITS_RE)?.length ?? 0) >= 20;
}

// Anexo: nome de arquivo com extensão. O nome inteiro sai — dentro dele pode
// haver nome de pessoa, número de documento ou identificador de cobrança.
const FILENAME_RE =
  /(?:[\p{L}\p{N}]+[._-])*[\p{L}\p{N}]+\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|jpe?g|png|heic|mp4|mp3|ogg|opus|zip)\b/giu;

// `\d*` no fim de propósito: no Pix o UUID vem grudado no campo seguinte, e
// deixar o resto para trás devolveria "[ID]5204" em vez de "[ID]".
const UUID_ANYWHERE_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\d*/gi;

const SCHEMELESS_URL_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|br|io|app|me|gov)(?:\.[a-z]{2})?(?:\/[^\s]*)?/gi;

export function redactCorpusText(text: string): string {
  // UUID antes de pagamento: o Pix contém um, e deixar o bloco inteiro virar
  // [PAGAMENTO] esconderia que havia um identificador ali.
  return text
    .replace(UUID_ANYWHERE_RE, "[ID]")
    .replace(PAYMENT_CANDIDATE_RE, (candidate) =>
      isPaymentPayload(candidate) ? "[PAGAMENTO]" : candidate,
    )
    .replace(FILENAME_RE, "[ARQUIVO]")
    .replace(SCHEMELESS_URL_RE, "[URL]")
    // Um bloco contínuo redigido por mais de uma regra vira uma marca só. O Pix
    // casa UUID e payload, e "[PAGAMENTO][ID]" só faria o leitor procurar dois
    // segredos onde havia um.
    .replace(
      /(\[(?:PAGAMENTO|ID|URL|ARQUIVO)\])(?:\[(?:PAGAMENTO|ID|URL|ARQUIVO)\])+/g,
      "$1",
    )
    // Payload de pagamento não se guarda pela metade: o que vem depois do
    // marcador é nome do recebedor, cidade e CRC, e meia string redigida ainda
    // parece revisada. A linha inteira sai.
    .split("\n")
    .map((line) => (line.includes("[PAGAMENTO]") ? "[PAGAMENTO]" : line))
    .join("\n")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Detectores usados como asserção final no parse do caso. São mais estritos que
 * as regras de redação: aqui a resposta certa é recusar o caso, não consertá-lo.
 */
export const CORPUS_RESIDUAL_PII_DETECTORS: Readonly<Record<string, RegExp>> = {
  attachedFile:
    /[\p{L}\p{N}_-]+\.(?:pdf|docx?|xlsx?|pptx?|csv|jpe?g|png|heic|mp4|mp3|ogg|opus|zip)\b/giu,
  paymentPayload: /\b\d{20,}/g,
  schemelessUrl:
    /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|br|io|app|me|gov)(?:\.[a-z]{2})?\//gi,
  uuid: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
};
