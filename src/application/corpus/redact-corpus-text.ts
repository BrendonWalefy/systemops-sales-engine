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

/**
 * Palavras que aparecem depois de uma saudação e não são nome de pessoa.
 *
 * A lista é empírica e nunca estará completa — e não precisa estar. Os dois
 * erros possíveis não custam a mesma coisa: uma palavra faltando aqui redige um
 * termo comum, o que aparece na revisão e se conserta; um nome que passa é
 * irreversível assim que o commit sai. Na dúvida, sobra-redigir.
 */
const NOT_A_NAME = [
  "tudo", "como", "que", "qual", "quanto", "quando", "onde", "preciso",
  "posso", "pode", "queria", "quero", "gostaria", "sei", "estou", "estamos",
  "nosso", "nossa", "aqui", "sou", "seja", "seria", "segue", "sem", "com",
  "para", "por", "obrigado", "obrigada", "perfeito", "entendi", "claro",
  "desculpa", "perdão", "muito", "meu", "minha", "temos", "tenho", "você",
  "vocês", "boa", "bom", "dia", "tarde", "noite", "doutor", "doutora",
  "atendimento", "time", "equipe", "clínica", "não", "sim", "ainda", "então",
  "mas", "vou", "vamos", "vai", "tem", "ele", "ela", "isso", "esse", "essa",
  "esta", "este", "uma", "aqui", "agora", "hoje", "amanhã", "sobre", "vim",
  "consegue", "poderia", "tudo", "somos", "estamos", "estava", "fico", "fica",
];

/**
 * Vocativo depois da saudação: "Olá <Nome>", "Bom dia <Nome>", "Fala <Nome>".
 *
 * Existe porque redigir por token exato não alcança nome grafado errado. Um
 * operador escreveu "Weberson" para um lead cadastrado como "Cleberson", e o
 * nome atravessou a sanitização até uma folha destinada a revisor externo. O
 * vocativo não depende de o nome bater com o cadastro.
 *
 * A saudação precisa terminar sem pontuação — "Boa tarde! Tudo bem?" não é
 * vocativo — e a palavra seguinte não pode ser uma continuação comum de frase,
 * senão a regra comeria justamente o texto que o revisor precisa ler.
 *
 * A regex é sensível a caixa de propósito: o nome vem capitalizado. Por isso a
 * saudação lista as duas grafias em vez de ligar a flag `i`, que apagaria a
 * exigência de maiúscula, e a exclusão usa a forma capitalizada das palavras
 * comuns — é a única que pode ocupar a posição do vocativo.
 */
function greetingVocativeRe(): RegExp {
  const stop = NOT_A_NAME.map(
    (word) => word[0]!.toUpperCase() + word.slice(1),
  ).join("|");
  return new RegExp(
    "([Oo]l[áa]|[Oo]i|[Bb]om dia|[Bb]oa tarde|[Bb]oa noite|[Ff]ala|[Ee] a[íi])" +
      `\\s+(?!(?:${stop})\\b)(\\p{Lu}\\p{Ll}{2,})\\b`,
    "gu",
  );
}

const SCHEMELESS_URL_RE =
  /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|br|io|app|me|gov)(?:\.[a-z]{2})?(?:\/[^\s]*)?/gi;

/**
 * Termo de identidade que o chamador conhece e o texto não deveria carregar.
 *
 * Nome comercial do tenant, prédio, bairro e estação nunca foram PII do lead, e
 * por isso nenhum detector de nome olhava para eles — mas identificam o tenant,
 * que o corpus troca por hash exatamente para não identificar. Como não há regra
 * geral que separe "Ximendes Odontologia" de um substantivo qualquer, a lista é
 * explícita e vem de fora: é uma deny-list, e vale só o que estiver nela.
 */
export type IdentityTerm = { term: string; marker: string };

function foldAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function redactIdentities(text: string, terms: readonly IdentityTerm[]): string {
  // Decompõe para NFD antes de casar: em NFD "í" vira "i" + acento combinante,
  // e aí `i\p{M}*` alcança as duas grafias. Sem isso, o termo só casaria na
  // forma exatamente igual à cadastrada — e a conversa real escreve as duas.
  let output = text.normalize("NFD");
  for (const { term, marker } of terms) {
    const pattern = foldAccents(term)
      .split(/\s+/)
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      // Cada token casa com ou sem acento: o texto real escreve "Clinica" e
      // "Clínica" na mesma conversa.
      .map((token) => token.split("").map((ch) => `${ch}\\p{M}*`).join(""))
      .join("\\s+");
    // Fronteira por classe de letra, não `\b`: `\b` não separa "Vitalli" de
    // "vitallidade" quando o termo é prefixo de outra palavra.
    output = output.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu"),
      marker,
    );
  }
  return output.normalize("NFC");
}

export function redactCorpusText(
  text: string,
  identityTerms: readonly IdentityTerm[] = [],
): string {
  // UUID antes de pagamento: o Pix contém um, e deixar o bloco inteiro virar
  // [PAGAMENTO] esconderia que havia um identificador ali.
  return redactIdentities(text, identityTerms)
    .replace(UUID_ANYWHERE_RE, "[ID]")
    .replace(PAYMENT_CANDIDATE_RE, (candidate) =>
      isPaymentPayload(candidate) ? "[PAGAMENTO]" : candidate,
    )
    .replace(FILENAME_RE, "[ARQUIVO]")
    .replace(SCHEMELESS_URL_RE, "[URL]")
    .replace(greetingVocativeRe(), "$1 [PACIENTE]")
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
  // Mesma regra da redação, e de propósito a mesma fonte: detector e barreira
  // que divergem deixam passar exatamente o que um dos dois acha que o outro
  // pegou.
  greetingVocative: greetingVocativeRe(),
};
