import type { ComposedResponse } from "@/core/intelligence/ResponseComposer";
import type {
  AuthorizedResponsePlan,
  ResponsePlanViolationCode,
} from "@/core/conversation/response-plan";

export type ResponseValidationResult =
  | { ok: true; violations: readonly [] }
  | { ok: false; violations: readonly ResponsePlanViolationCode[] };

const VIOLATION_ORDER: ResponsePlanViolationCode[] = [
  "empty_response",
  "response_too_long",
  "too_many_questions",
  "unauthorized_media",
  "unauthorized_price",
  "unauthorized_schedule_fact",
  "unsupported_guarantee",
];

type ScheduleFact = {
  weekday: string | null;
  date: string | null;
  time: string | null;
};

export function validateComposedResponse(input: {
  plan: AuthorizedResponsePlan;
  response: Pick<ComposedResponse, "text" | "parts">;
}): ResponseValidationResult {
  const violations = new Set<ResponsePlanViolationCode>();
  const deliveryText = collectDeliveryText(input.response);
  const textToValidate = deliveryText.sources.join("\n");

  if (!textToValidate && input.response.parts.length === 0) violations.add("empty_response");
  if (deliveryText.characterCount > input.plan.maxCharacters) violations.add("response_too_long");
  if (deliveryText.questionCount > input.plan.maxQuestions) violations.add("too_many_questions");

  if (input.response.parts.some(
    (part) => part.type === "media" && !input.plan.allowedMediaIds.includes(part.id),
  )) {
    violations.add("unauthorized_media");
  }

  if (extractClaimedPriceCents(textToValidate).some(
    (priceCents) => !input.plan.allowedPriceCents.includes(priceCents),
  )) {
    violations.add("unauthorized_price");
  }

  if (containsUnauthorizedScheduleFact(textToValidate, input.plan.allowedScheduleFacts)) {
    violations.add("unauthorized_schedule_fact");
  }

  if (hasUnsupportedGuarantee(textToValidate)) violations.add("unsupported_guarantee");

  const orderedViolations = VIOLATION_ORDER.filter((code) => violations.has(code));
  return orderedViolations.length === 0
    ? { ok: true, violations: [] }
    : { ok: false, violations: orderedViolations };
}

function collectDeliveryText(
  response: Pick<ComposedResponse, "text" | "parts">,
): { sources: string[]; characterCount: number; questionCount: number } {
  const responseText = response.text.trim();
  const partTexts = response.parts.flatMap((part) => {
    const normalized = part.type === "text" ? part.content.trim() : "";
    return normalized ? [normalized] : [];
  });
  const captions = response.parts.flatMap((part) => {
    const normalized = part.type === "media" ? part.caption?.trim() : "";
    return normalized ? [normalized] : [];
  });
  const emittedText = [...partTexts, ...captions].join("\n");

  return {
    sources: [responseText, emittedText].filter(Boolean),
    characterCount: Math.max(response.text.length, [...partTexts, ...captions].reduce(
      (total, partText) => total + partText.length,
      0,
    )),
    questionCount: Math.max(countQuestions(responseText), countQuestions(emittedText)),
  };
}

function countQuestions(text: string): number {
  return [...text].filter((character) => character === "?").length;
}

function extractClaimedPriceCents(text: string): number[] {
  const values = new Set<number>();
  const addMatches = (pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      const cents = toBrlCents(match[1]!, match[2]);
      if (cents !== null) values.add(cents);
    }
  };

  addMatches(/R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/gi);
  addMatches(/(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?\s*reais\b/gi);
  addMatches(/\b\d{1,2}\s*x\s*(?:de\s*)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/gi);
  addMatches(/\b(?:\d+\s*)?parcelas?\s+de\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/gi);

  return [...values];
}

function toBrlCents(integerPart: string, decimalPart: string | undefined): number | null {
  const reais = Number(integerPart.replace(/\./g, ""));
  if (!Number.isSafeInteger(reais) || reais < 0) return null;

  const centavos = decimalPart ? Number(decimalPart.padEnd(2, "0")) : 0;
  return reais * 100 + centavos;
}

function containsUnauthorizedScheduleFact(text: string, allowedLabels: readonly string[]): boolean {
  const allowedFacts = allowedLabels.flatMap(extractScheduleFacts);
  return extractScheduleFacts(text).some((candidate) => !allowedFacts.some(
    (allowed) => isSameScheduleFact(candidate, allowed),
  ));
}

function extractScheduleFacts(text: string): ScheduleFact[] {
  const facts: ScheduleFact[] = [];
  const timePattern = /\b([01]?\d|2[0-3])(?:h|:)([0-5]\d)?\b/gi;
  const sentences = text.split(/[.!?\n]+/);

  for (const sentence of sentences) {
    for (const match of sentence.matchAll(timePattern)) {
      const beforeTime = sentence.slice(Math.max(0, match.index! - 48), match.index);
      const weekdayMatch = beforeTime.match(/\b(seg(?:unda)?|ter(?:ca|ça)?|quarta|qua|quinta|qui|sexta|sex|sab(?:ado)?|sáb(?:ado)?|dom(?:ingo)?)\b/gi)?.at(-1);
      const dateMatch = beforeTime.match(/\b([0-3]?\d)\s*[/-]\s*([01]?\d)\b/g)?.at(-1);
      if (!hasAvailabilityContext(sentence)
        && !weekdayMatch
        && !dateMatch
        && !/\bas\s*$/i.test(normalizeText(beforeTime))) {
        continue;
      }

      facts.push({
        weekday: weekdayMatch ? normalizeWeekday(weekdayMatch) : null,
        date: dateMatch ? normalizeDate(dateMatch) : null,
        time: normalizeTime(match[1]!, match[2]),
      });
    }
  }

  for (const sentence of sentences) {
    if (/\b(?:[01]?\d|2[0-3])(?:h|:)(?:[0-5]\d)?\b/i.test(sentence)) continue;
    if (!hasAvailabilityContext(sentence)) continue;

    const weekdayMatches = [...sentence.matchAll(/\b(seg(?:unda)?|ter(?:ca|ça)?|quarta|qua|quinta|qui|sexta|sex|sab(?:ado)?|sáb(?:ado)?|dom(?:ingo)?)\b/gi)];
    const dateMatches = [...sentence.matchAll(/\b([0-3]?\d)\s*[/-]\s*([01]?\d)\b/g)];

    if (dateMatches.length > 0) {
      for (const dateMatch of dateMatches) {
        facts.push({
          weekday: weekdayMatches.length === 1
            ? normalizeWeekday(weekdayMatches[0]![0])
            : null,
          date: normalizeDate(dateMatch[0]),
          time: null,
        });
      }
      continue;
    }

    for (const weekdayMatch of weekdayMatches) {
      facts.push({
        weekday: normalizeWeekday(weekdayMatch[0]),
        date: null,
        time: null,
      });
    }
  }

  return facts;
}

function isSameScheduleFact(candidate: ScheduleFact, allowed: ScheduleFact): boolean {
  return (!candidate.time || candidate.time === allowed.time)
    && (!candidate.weekday || candidate.weekday === allowed.weekday)
    && (!candidate.date || candidate.date === allowed.date);
}

function hasAvailabilityContext(value: string): boolean {
  const normalized = normalizeText(value);
  return /\b(?:agenda|agendar|disponibilidade|disponivel|horario|marcar|opcao|slot|temos?|tenho|vagas?)\b/.test(normalized);
}

function normalizeWeekday(value: string): string {
  const normalized = normalizeText(value);
  if (normalized.startsWith("seg")) return "seg";
  if (normalized.startsWith("ter")) return "ter";
  if (normalized.startsWith("qua")) return "qua";
  if (normalized.startsWith("qui")) return "qui";
  if (normalized.startsWith("sex")) return "sex";
  if (normalized.startsWith("sab")) return "sab";
  return "dom";
}

function normalizeDate(value: string): string {
  const [day, month] = value.split(/[/-]/).map(Number);
  return `${day}/${month}`;
}

function normalizeTime(hour: string, minutes: string | undefined): string {
  return `${Number(hour)}h${minutes && minutes !== "00" ? minutes : ""}`;
}

function hasUnsupportedGuarantee(text: string): boolean {
  const normalized = normalizeText(text);
  return /\b(?:resultados?\s+(?:100\s*%\s*)?garantid[oa]s?|100\s*%\s*garantid[oa]|sem\s+(?:nenhum\s+)?risco|risco\s+zero|resultado\s+certo|(?:prometemos|prometo|garantimos|garanto)\s+(?:(?:um|os?)\s+)?resultados?|resultados?\s+assegurad[oa]s?)\b/.test(normalized);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
