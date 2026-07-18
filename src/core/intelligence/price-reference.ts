// Extrai um valor monetário explicitamente citado pelo lead.
// A referência da mensagem atual tem prioridade sobre qualquer preço inferido
// a partir do tratamento, histórico ou política comercial.

export type ReferencedPrice = {
  cents: number;
  formatted: string;
};

const MONEY_CONTEXT_RE = /(?:r\$|\b(?:valor|pre[cç]o|investimento|parcel\w*|pagar|cart[aã]o|custa|custaria)\b)/i;
const MONEY_TOKEN_RE = /\b(\d+(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)\b/g;

function parseAmountToCents(raw: string): number | null {
  const value = raw.replace(/\s/g, "");
  const separators = [...value].filter((char) => char === "." || char === ",");
  if (separators.length === 0) {
    const reais = Number(value);
    return Number.isSafeInteger(reais) ? reais * 100 : null;
  }

  const lastSeparator = Math.max(value.lastIndexOf("."), value.lastIndexOf(","));
  const decimals = value.length - lastSeparator - 1;
  const hasDecimalPart = decimals === 2;
  const normalized = hasDecimalPart
    ? `${value.slice(0, lastSeparator).replace(/[.,]/g, "")}.${value.slice(lastSeparator + 1)}`
    : value.replace(/[.,]/g, "");
  const reais = Number(normalized);
  if (!Number.isFinite(reais) || reais <= 0) return null;

  const cents = Math.round(reais * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatReferencedPrice(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Retorna o primeiro valor plausível citado em uma pergunta comercial.
 * Exige contexto de preço/pagamento para não confundir telefone ou outros
 * números da mensagem com o valor do tratamento.
 */
export function extractReferencedPrice(message: string): ReferencedPrice | null {
  if (!MONEY_CONTEXT_RE.test(message)) return null;

  for (const match of message.matchAll(MONEY_TOKEN_RE)) {
    const cents = parseAmountToCents(match[1]);
    // Valores clínicos abaixo de R$100 não são uma referência de pacote neste
    // fluxo; o limite também evita capturar números incidentais.
    if (cents === null || cents < 10_000 || cents > 100_000_000) continue;
    return { cents, formatted: formatReferencedPrice(cents) };
  }

  return null;
}
