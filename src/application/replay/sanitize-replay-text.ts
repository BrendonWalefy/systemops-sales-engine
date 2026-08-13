import { anonymizeText } from "@/application/setup-study/build-corpus";

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CEP_RE = /\b\d{5}-?\d{3}\b/g;
const URL_RE = /https?:\/\/[^\s)"'<>]+/gi;
const HANDLE_RE = /(^|\s)@[A-Z0-9._-]{2,}/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const ADDRESS_RE =
  /\b(?:rua|r\.|avenida|av\.|alameda|travessa|estrada|rodovia)\s+[^;\n]{2,100}/giu;
const SELF_IDENTIFICATION_RE =
  /\b(?:me chamo|meu nome (?:e|é)|sou a|sou o)\s+[\p{L}][\p{L}\s'-]{1,60}/giu;

// Telefone brasileiro com separador. A redação de "8+ dígitos contíguos" do
// anonymizeText NÃO pega "11 98765-4321": o hífen quebra a sequência, e o
// número do paciente sobrevivia inteiro. Medido em 13/08/2026.
// Exige DDD ou prefixo internacional para não engolir preço ("2500") nem
// data/hora ("15/06", "14:30").
const PHONE_RE =
  /(?:\+\s?55\s?)?(?:\(\s?\d{2}\s?\)|\b\d{2})\s?9?\s?\d{4}[\s-]?\d{4}\b/g;
// Fixo de 8 dígitos com hífen, sem DDD ("3456-7890").
const LANDLINE_RE = /\b\d{4}-\d{4}\b/g;

// Nome de terceiro precedido de título profissional. Título é sinal forte o
// bastante para redigir sem NER; sem ele, nome de terceiro fica fora do alcance
// de regex — e é por isso que a revisão humana continua obrigatória.
const TITLED_NAME_RE =
  /\b(?:dr|dra|doutor|doutora|sr|sra|senhor|senhora)\.?\s+\p{Lu}?[\p{L}]{2,}(?:\s+\p{Lu}[\p{L}]{2,})?/giu;

// Nome logo após vínculo familiar: o vínculo é preservado (importa para a
// conversa), o nome sai.
const RELATIVE_NAME_RE =
  /\b(marido|esposa|esposo|mulher|filho|filha|m[aã]e|pai|irm[aã]o|irm[aã]|namorado|namorada|sogr[ao])\s+\p{Lu}[\p{L}]{2,}/giu;

// Data com ano de QUATRO dígitos (nascimento). Data curta como "15/06" é
// preservada de propósito: a extração de preferência de horário depende dela.
const BIRTH_DATE_RE = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{4}\b/g;

/**
 * Sanitização conservadora para artefatos de replay. É uma primeira barreira,
 * não aprovação para compartilhamento: datasets continuam `needs_review` até
 * revisão humana explícita.
 */
export function sanitizeReplayText(text: string, leadName: string | null): string {
  return anonymizeText(text, leadName)
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(CNPJ_RE, "[CNPJ]")
    .replace(CPF_RE, "[CPF]")
    // Nascimento antes de CEP: "15/03/1985" não deve virar [CEP].
    .replace(BIRTH_DATE_RE, "[DATA]")
    .replace(CEP_RE, "[CEP]")
    .replace(URL_RE, "[URL]")
    .replace(HANDLE_RE, "$1[USUARIO]")
    .replace(UUID_RE, "[ID]")
    .replace(PHONE_RE, "[TELEFONE]")
    .replace(LANDLINE_RE, "[TELEFONE]")
    .replace(ADDRESS_RE, "[ENDERECO]")
    .replace(TITLED_NAME_RE, "[PROFISSIONAL]")
    .replace(RELATIVE_NAME_RE, "$1 [PESSOA]")
    .replace(SELF_IDENTIFICATION_RE, "[PACIENTE]")
    .trim();
}

export const replayPiiDetectors = {
  email: EMAIL_RE,
  cpf: CPF_RE,
  cnpj: CNPJ_RE,
  cep: CEP_RE,
  url: URL_RE,
  uuid: UUID_RE,
} as const;
