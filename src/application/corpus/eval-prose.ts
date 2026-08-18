import type { CorpusCase } from "@/application/corpus/corpus-case";

/**
 * Camada 3 — Prosa, parte determinística.
 *
 * O que dá para conferir sem opinião de modelo fica aqui: preço, tamanho,
 * número de perguntas, mídia, repetição de bloco já dito. O judge par a par
 * julga o que sobra — naturalidade, clareza, condução comercial — e não é
 * chamado para nada que esta função consiga responder sozinha.
 *
 * A fronteira importa: nota absoluta de modelo deriva entre rodadas, e usá-la
 * para medir preço ou tamanho trocaria uma verificação estável por uma instável.
 */

export type ProseMetrics = {
  characters: number;
  questionCount: number;
  /** Valores em reais citados no texto, em centavos. */
  quotedPriceCents: number[];
  /** Preços citados que não constam do catálogo do tenant. */
  unauthorizedPriceCents: number[];
  /** Trecho de 8+ palavras repetido de um turno anterior do agente. */
  repeatsPreviousBlock: boolean;
  mediaOnly: boolean;
};

const PRICE_PATTERN = /R\$\s?([\d.]+(?:,\d{2})?)/g;
const MEDIA_MARKER = /^\s*(?:\[MIDIA:[A-Z]+\]\s*)+$/;

export function parseQuotedPrices(text: string): number[] {
  const prices: number[] = [];
  for (const match of text.matchAll(PRICE_PATTERN)) {
    const raw = match[1]!;
    // "2.000" é dois mil, "2.000,00" também; "150" é cento e cinquenta.
    const normalized = raw.replace(/\./g, "").replace(",", ".");
    const value = Number(normalized);
    if (Number.isFinite(value)) prices.push(Math.round(value * 100));
  }
  return prices;
}

function normalizeWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function repeatsPreviousBlock(
  text: string,
  history: CorpusCase["input"]["history"],
): boolean {
  const words = normalizeWords(text);
  if (words.length < 8) return false;
  const shingles = new Set<string>();
  for (let index = 0; index + 8 <= words.length; index += 1) {
    shingles.add(words.slice(index, index + 8).join(" "));
  }
  for (const turn of history) {
    if (turn.author === "lead") continue;
    const previous = normalizeWords(turn.body);
    for (let index = 0; index + 8 <= previous.length; index += 1) {
      if (shingles.has(previous.slice(index, index + 8).join(" "))) return true;
    }
  }
  return false;
}

export function measureProse(params: {
  text: string;
  history: CorpusCase["input"]["history"];
  authorizedPriceCents: number[];
}): ProseMetrics {
  const quoted = parseQuotedPrices(params.text);
  const authorized = new Set(params.authorizedPriceCents);
  return {
    characters: params.text.length,
    questionCount: (params.text.match(/\?/g) ?? []).length,
    quotedPriceCents: quoted,
    unauthorizedPriceCents: quoted.filter((value) => !authorized.has(value)),
    repeatsPreviousBlock: repeatsPreviousBlock(params.text, params.history),
    mediaOnly: MEDIA_MARKER.test(params.text),
  };
}

export type ProseAggregate = {
  responses: number;
  medianCharacters: number;
  responsesOver400Characters: number;
  responsesWithTwoOrMoreQuestions: number;
  responsesQuotingUnauthorizedPrice: number;
  responsesRepeatingPreviousBlock: number;
  mediaOnlyResponses: number;
};

export function aggregateProse(metrics: ProseMetrics[]): ProseAggregate {
  const lengths = metrics.map((entry) => entry.characters).sort((a, b) => a - b);
  const middle = Math.floor(lengths.length / 2);
  return {
    responses: metrics.length,
    medianCharacters:
      lengths.length === 0
        ? 0
        : lengths.length % 2 === 1
          ? lengths[middle]!
          : Math.round(((lengths[middle - 1] ?? 0) + (lengths[middle] ?? 0)) / 2),
    responsesOver400Characters: metrics.filter((entry) => entry.characters > 400)
      .length,
    responsesWithTwoOrMoreQuestions: metrics.filter(
      (entry) => entry.questionCount >= 2,
    ).length,
    responsesQuotingUnauthorizedPrice: metrics.filter(
      (entry) => entry.unauthorizedPriceCents.length > 0,
    ).length,
    responsesRepeatingPreviousBlock: metrics.filter(
      (entry) => entry.repeatsPreviousBlock,
    ).length,
    mediaOnlyResponses: metrics.filter((entry) => entry.mediaOnly).length,
  };
}
