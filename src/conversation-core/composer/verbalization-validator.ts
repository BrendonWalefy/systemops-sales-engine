/**
 * O plano autorizado já decidiu o que pode ser dito. Este validador olha o texto
 * final e recusa qualquer coisa que o plano não sustenta: número novo, moeda sem
 * valor autorizado, link, promessa ou uma segunda pergunta. Recusar não é
 * silêncio — quem chama volta para o texto determinístico do mesmo plano.
 */
export type AuthorizedSurface = Readonly<{
  numbers: readonly string[];
  /** Subconjunto de `numbers` que só pode aparecer como dinheiro. */
  moneyNumbers: readonly string[];
  currencyAllowed: boolean;
  maxQuestions: number;
  maxCharacters: number;
}>;

export const VERBALIZATION_VIOLATION_CODES = [
  "empty_text",
  "too_long",
  "too_many_questions",
  "unauthorized_number",
  "unauthorized_currency",
  "money_without_currency",
  "unauthorized_link",
  "unauthorized_commitment",
] as const;

export type VerbalizationViolationCode = typeof VERBALIZATION_VIOLATION_CODES[number];

export type VerbalizationValidationResult =
  | { valid: true; text: string }
  | { valid: false; violations: readonly VerbalizationViolationCode[] };

const GROUPED_NUMBER = /\d{1,3}(?:[.\u00a0\u202f ]\d{3})+/g;
const NUMBER_TOKEN = /\d+(?:,\d+)?/g;
const CURRENCY = /R\$|\bBRL\b/i;
const CURRENCY_AMOUNT = /R\$\s*(\d[\d.\u00a0\u202f ]*(?:,\d+)?)/g;
const LINK = /https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|br|net|org|io)\b/i;
/** Compromisso em primeira pessoa: o sistema nunca decidiu prometer nada. */
const COMMITMENT = /\b(?:garanto|garantimos|prometo|prometemos|asseguro|asseguramos|juro|juramos)\b/;

export function canonicalNumber(raw: string): string {
  const [whole, fraction = ""] = raw.split(",");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const trimmedWhole = whole!.replace(/^0+(?=\d)/, "");
  return trimmedFraction ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole;
}

export function numbersIn(text: string): readonly string[] {
  const ungrouped = text.replace(GROUPED_NUMBER, (match) => match.replace(/[.\u00a0\u202f ]/g, ""));
  return Object.freeze((ungrouped.match(NUMBER_TOKEN) ?? []).map(canonicalNumber));
}

function withoutAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Um valor em dinheiro escrito como número solto vira ambiguidade na tela do
 * leitor: "290" nao diz reais, nem parcela, nem quantidade.
 */
function mentionsMoneyWithoutCurrency(
  text: string,
  moneyNumbers: readonly string[],
): boolean {
  if (moneyNumbers.length === 0) return false;
  const asMoney = new Set(
    [...text.matchAll(CURRENCY_AMOUNT)].flatMap(([, amount]) => numbersIn(amount!)),
  );
  const mentioned = new Set(numbersIn(text));
  return moneyNumbers
    .map(canonicalNumber)
    .some((value) => mentioned.has(value) && !asMoney.has(value));
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
  if (text.length > input.surface.maxCharacters) violations.push("too_long");

  const questions = (text.match(/\?/g) ?? []).length;
  if (questions > input.surface.maxQuestions) violations.push("too_many_questions");

  const authorized = new Set(input.surface.numbers.map(canonicalNumber));
  if (numbersIn(text).some((value) => !authorized.has(value))) {
    violations.push("unauthorized_number");
  }
  if (!input.surface.currencyAllowed && CURRENCY.test(text)) {
    violations.push("unauthorized_currency");
  }
  if (mentionsMoneyWithoutCurrency(text, input.surface.moneyNumbers)) {
    violations.push("money_without_currency");
  }
  if (LINK.test(text)) violations.push("unauthorized_link");
  if (COMMITMENT.test(withoutAccents(text))) violations.push("unauthorized_commitment");

  if (violations.length > 0) {
    return { valid: false, violations: Object.freeze(violations) };
  }
  return { valid: true, text };
}
