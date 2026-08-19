/**
 * O plano autorizado já decidiu o que pode ser dito. Este validador olha o texto
 * final e responde uma pergunta só: ele diz exatamente aquilo, nem mais nem
 * menos?
 *
 * Validar token numérico solto não bastava. Com "Qua 20/08 às 15h30" e
 * "Qui 21/08 às 9h" autorizados, os dígitos 21, 08 e 15 existem no conjunto, e
 * "Qua 21/08 às 15h" — um horário que nunca foi oferecido — passava. Por isso a
 * unidade de validação é o valor inteiro: cada valor autorizado precisa aparecer
 * completo, e todo dígito fora desses trechos é rejeitado.
 *
 * Recusar não é silêncio: quem chama volta para o texto determinístico do mesmo
 * plano.
 */
export type AuthorizedSurface = Readonly<{
  /** Cada valor divulgável, exatamente como o leitor deve lê-lo. */
  values: readonly string[];
  /** Subconjunto de `values` que representa dinheiro. */
  moneyValues: readonly string[];
  /** Dígitos que podem aparecer fora dos valores, vindos do nome do assunto. */
  numbers: readonly string[];
  currencyAllowed: boolean;
  maxQuestions: number;
  maxCharacters: number;
}>;

export const VERBALIZATION_VIOLATION_CODES = [
  "empty_text",
  "too_long",
  "too_many_questions",
  "missing_authorized_value",
  "unauthorized_number",
  "unauthorized_currency",
  "unauthorized_link",
  "unauthorized_commitment",
] as const;

export type VerbalizationViolationCode = typeof VERBALIZATION_VIOLATION_CODES[number];

export type VerbalizationValidationResult =
  | { valid: true; text: string }
  | { valid: false; violations: readonly VerbalizationViolationCode[] };

export const DIGIT_RUN = /\p{Nd}[\p{Nd}.,:/h\u00a0\u202f -]*\p{Nd}|\p{Nd}/gu;
const MONEY_LEXEME = /R\$|\bBRL\b|\breais?\b|\bcontos?\b/i;
const LINK = /https?:\/\/|\bwww\.|@[a-z0-9_.]{3,}|\b[a-z0-9-]+\.(?:com|br|net|org|io)\b/i;
/**
 * Compromisso pessoal: o sistema nunca decidiu prometer, garantir ou jurar nada.
 * Prometer retorno é o caso mais comum e o menos evidente — "te aviso" soa
 * gentil e cria uma obrigação que nenhuma capability assumiu. Convidar o lead a
 * avisar é o contrário disso e continua permitido.
 */
const COMMITMENT = /\b(?:garant|promet|assegur|jur)\w*|\b(?:te|lhe|voce)\s+(?:aviso|avisamos|retorno|retornamos|informo|informamos)\b|\b(?:aviso|avisamos|retorno|retornamos)\s+(?:voce|para voce|assim que)\b|\bentr(?:o|amos|aremos)\s+em\s+contato\b/;
/**
 * Numeral escrito por extenso só é fato quando encosta em dinheiro ou em tempo.
 * "um instante" é conversa; "trezentos reais" e "oito da manhã" são afirmações
 * que nenhuma capability tomou.
 */
const CARDINAL_WORDS = "(?:zero|uma?|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|mil|milh[oõ]es|milh[aã]o|meia)";
const TIME_LEXEME = "(?:horas?|hora|manh[aã]|tarde|noite|minutos?|dias?|semanas?|meses|m[eê]s)";
const SPELLED_MONEY = new RegExp(`\\b${CARDINAL_WORDS}(?:\\s+(?:e|de)\\s+${CARDINAL_WORDS})*\\s+(?:reais?|contos?)\\b`, "i");
const SPELLED_TIME = new RegExp(`\\b${CARDINAL_WORDS}(?:\\s+(?:e|da|de)\\s+${CARDINAL_WORDS})*\\s+(?:da|de|as|às)?\\s*${TIME_LEXEME}\\b`, "i");

function withoutAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

/** Compara valor e texto pela mesma forma: sem acento, sem caixa, sem espaço duplo. */
function comparable(text: string): string {
  return withoutAccents(text).replace(/\s+/g, " ").trim();
}

/**
 * Apaga do texto cada valor autorizado que aparece inteiro, e devolve o que
 * sobrou junto da lista de valores que não foram encontrados.
 */
function consumeAuthorizedValues(
  text: string,
  values: readonly string[],
): Readonly<{ remainder: string; missing: readonly string[] }> {
  let remainder = comparable(text);
  const missing: string[] = [];
  const longestFirst = [...values].sort((a, b) => b.length - a.length);
  for (const value of longestFirst) {
    const needle = comparable(value);
    if (needle.length === 0) continue;
    // Todas as ocorrências, e não só a primeira: repetir um valor autorizado é
    // ênfase, e cobrar por isso mandaria a frase inteira para o texto de máquina.
    let consumed = false;
    for (let at = remainder.indexOf(needle); at >= 0; at = remainder.indexOf(needle)) {
      remainder = `${remainder.slice(0, at)} ${remainder.slice(at + needle.length)}`;
      consumed = true;
    }
    if (!consumed) missing.push(value);
  }
  return Object.freeze({ remainder, missing: Object.freeze(missing) });
}

function digitRunsIn(text: string): readonly string[] {
  return Object.freeze([...(text.match(DIGIT_RUN) ?? [])]);
}

export function validateVerbalizedText(input: Readonly<{
  text: unknown;
  surface: AuthorizedSurface;
}>): VerbalizationValidationResult {
  const text = typeof input.text === "string" ? input.text : "";
  if (text.trim().length === 0) {
    return { valid: false, violations: Object.freeze(["empty_text" as const]) };
  }

  const violations: VerbalizationViolationCode[] = [];
  if ([...text].length > input.surface.maxCharacters) violations.push("too_long");

  const questions = (text.match(/\?/g) ?? []).length;
  if (questions > input.surface.maxQuestions) violations.push("too_many_questions");

  const consumed = consumeAuthorizedValues(text, input.surface.values);
  if (consumed.missing.length > 0) violations.push("missing_authorized_value");

  const allowedRuns = new Set(input.surface.numbers.map(comparable));
  const leftoverRuns = digitRunsIn(consumed.remainder).filter((run) => !allowedRuns.has(run));
  if (leftoverRuns.length > 0 || SPELLED_TIME.test(consumed.remainder)) {
    violations.push("unauthorized_number");
  }

  const moneyMentioned = MONEY_LEXEME.test(text) || SPELLED_MONEY.test(comparable(text));
  if (!input.surface.currencyAllowed && moneyMentioned) {
    violations.push("unauthorized_currency");
  } else if (SPELLED_MONEY.test(consumed.remainder)) {
    violations.push("unauthorized_currency");
  }

  if (LINK.test(text)) violations.push("unauthorized_link");
  if (COMMITMENT.test(withoutAccents(text))) violations.push("unauthorized_commitment");

  if (violations.length > 0) {
    return { valid: false, violations: Object.freeze(violations) };
  }
  return { valid: true, text };
}
