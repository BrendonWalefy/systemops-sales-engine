import type { ComposedResponse } from "@/core/intelligence/ResponseComposer";
import type {
  AuthorizedService,
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
  "unauthorized_service",
  "service_price_mismatch",
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

  // Catálogo vazio = caminho que ainda não declara serviços; ambas ficam inertes.
  if (input.plan.allowedServices.length > 0) {
    if (mentionsUnauthorizedService(textToValidate, input.plan.allowedServices)) {
      violations.add("unauthorized_service");
    }
    if (hasServicePriceMismatch(textToValidate, input.plan.allowedServices)) {
      violations.add("service_price_mismatch");
    }
  }

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

const PRICE_PATTERNS = [
  /R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/gi,
  /(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?\s*reais\b/gi,
  /\b\d{1,2}\s*x\s*(?:de\s*)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/gi,
  /\b(?:\d+\s*)?parcelas?\s+de\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?/gi,
];

/**
 * Preços citados, com a posição de cada um. A posição é medida sobre o texto
 * **normalizado**, o mesmo espaço em que os nomes de serviço são procurados —
 * casar índice de um texto com janela de outro daria vizinhança deslocada.
 */
function locateClaimedPrices(text: string): Array<{ cents: number; index: number }> {
  const normalized = normalizeText(text);
  const found: Array<{ cents: number; index: number }> = [];
  for (const pattern of PRICE_PATTERNS) {
    for (const match of normalized.matchAll(pattern)) {
      const cents = toBrlCents(match[1]!, match[2]);
      if (cents !== null) found.push({ cents, index: match.index ?? 0 });
    }
  }
  return found;
}

function extractClaimedPriceCents(text: string): number[] {
  return [...new Set(locateClaimedPrices(text).map((price) => price.cents))];
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

/** Nome e aliases de um serviço, normalizados, do mais longo para o mais curto. */
function authorizedTerms(service: AuthorizedService): string[] {
  return [service.name, ...service.aliases]
    .map(normalizeText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

/**
 * Tokens do catálogo que servem de âncora. Curtos ("de", "e") não ancoram nada:
 * apareceriam em qualquer frase. O corte por tamanho é sobre o *catálogo*, não
 * sobre a língua — não há lista de palavras do português aqui.
 */
const MIN_ANCHOR_TOKEN_LENGTH = 4;

function anchorTokens(services: readonly AuthorizedService[]): string[] {
  const tokens = new Set<string>();
  for (const service of services) {
    for (const term of authorizedTerms(service)) {
      for (const token of term.split(" ")) {
        if (token.length >= MIN_ANCHOR_TOKEN_LENGTH) tokens.add(token);
      }
    }
  }
  return [...tokens];
}

/**
 * Serviço nomeado fora do catálogo.
 *
 * Ancorado nos fatos autorizados, nunca em substantivo solto: primeiro apaga do
 * texto toda ocorrência de um termo autorizado (nome ou alias, casamento mais
 * longo primeiro), depois procura no que sobrou algum token do próprio catálogo.
 * Token do catálogo que sobreviveu significa que o texto usou o vocabulário da
 * clínica para montar um serviço que ela não tem — "lentes de contato dental"
 * onde só existe "Lentes de resina".
 *
 * Limite conhecido e deliberado: serviço inventado que não compartilha nenhuma
 * palavra com o catálogo não é detectado. Detectá-lo exigiria conhecer o universo
 * de nomes de procedimento, que é dado de domínio que não temos.
 */
function mentionsUnauthorizedService(
  text: string,
  services: readonly AuthorizedService[],
): boolean {
  let remaining = ` ${normalizeText(text)} `;
  const terms = services
    .flatMap(authorizedTerms)
    .sort((left, right) => right.length - left.length);

  for (const term of terms) {
    remaining = remaining.split(term).join(" ");
  }

  return anchorTokens(services).some((token) =>
    new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:[^a-z0-9]|$)`).test(remaining),
  );
}

/**
 * Preço autorizado colado num serviço que não é o dono dele.
 *
 * `allowedPriceCents` é uma lista solta de números: sozinha, ela aprova
 * "clareamento por R$ 2.000" porque 2.000 é um preço real da clínica — só que das
 * lentes. Aqui o vínculo preço↔serviço do plano é usado: para cada preço citado,
 * se a janela ao redor nomeia outro serviço e **não** nomeia o dono, é troca.
 */
const PRICE_CONTEXT_WINDOW = 60;

function hasServicePriceMismatch(
  text: string,
  services: readonly AuthorizedService[],
): boolean {
  const normalized = normalizeText(text);
  const owners = new Map<number, AuthorizedService>();
  for (const service of services) {
    if (service.priceCents !== null) owners.set(service.priceCents, service);
  }
  if (owners.size === 0) return false;

  for (const { cents, index } of locateClaimedPrices(text)) {
    const owner = owners.get(cents);
    if (!owner) continue; // preço não autorizado já é `unauthorized_price`

    const window = normalized.slice(
      Math.max(0, index - PRICE_CONTEXT_WINDOW),
      index + PRICE_CONTEXT_WINDOW,
    );
    const namesOwner = authorizedTerms(owner).some((term) => window.includes(term));
    if (namesOwner) continue;

    const namesOther = services.some(
      (service) =>
        service !== owner
        && authorizedTerms(service).some((term) => window.includes(term)),
    );
    if (namesOther) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
