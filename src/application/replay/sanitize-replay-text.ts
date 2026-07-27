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
    .replace(CEP_RE, "[CEP]")
    .replace(URL_RE, "[URL]")
    .replace(HANDLE_RE, "$1[USUARIO]")
    .replace(UUID_RE, "[ID]")
    .replace(ADDRESS_RE, "[ENDERECO]")
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
