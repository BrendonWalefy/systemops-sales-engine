import type { Treatment, TreatmentQuantityPrice } from "@/domain/entities/treatment";

// A4 — Preço por quantidade fechada (pacotes de lentes/facetas).
//
// Clínicas vendem pacotes cujo preço NÃO é proporcional à quantidade (na Aurora,
// 10 lentes = R$1.500 e 20 = R$1.800). Quando o lead pergunta uma quantidade que não
// está na tabela ("16 lentes"), a IA não pode extrapolar — o histórico mostra que ela
// chutava R$2.000 (o valor de 20), contradizendo o que a operadora cotou (R$1.800).
// Este módulo é DETERMINÍSTICO: extrai a quantidade, casa contra a tabela e devolve
// ou os valores exatos, ou um escalonamento para a equipe. A LLM nunca decide o número.

export type QuantityScope = "total" | "superior" | "inferior";

function formatBrl(cents: number): string {
  const reais = cents / 100;
  const isRound = cents % 100 === 0;
  return `R$ ${reais.toLocaleString("pt-BR", {
    minimumFractionDigits: isRound ? 0 : 2,
    maximumFractionDigits: isRound ? 0 : 2,
  })}`;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Substantivos de unidade que indicam pergunta por quantidade de pacote.
const UNIT_NOUNS = ["lentes", "lente", "dentes", "dente", "facetas", "faceta", "elementos", "elemento"];

const SUPERIOR_RE = /\b(arcada superior|superiores?|de cima|em cima|so as de cima|parte de cima)\b/;
const INFERIOR_RE = /\b(arcada inferior|inferiores?|de baixo|em baixo|so as de baixo|parte de baixo)\b/;

export function detectScope(message: string): QuantityScope {
  const n = normalize(message);
  if (SUPERIOR_RE.test(n)) return "superior";
  if (INFERIOR_RE.test(n)) return "inferior";
  return "total";
}

// Extrai a quantidade (número) quando acompanhada de um substantivo de unidade
// (ex.: "16 lentes", "quero 9 dentes"). Retorna null quando não há quantidade clara —
// nesse caso o fluxo normal de preço (piso "a partir de") assume.
export function extractQuantity(message: string): number | null {
  const n = normalize(message);
  const unitAlt = UNIT_NOUNS.join("|");
  // número seguido (com até 3 palavras no meio) de um substantivo de unidade
  const re = new RegExp(`\\b(\\d{1,2})\\b(?:\\s+\\w+){0,3}?\\s+(?:${unitAlt})\\b`);
  const m = n.match(re);
  if (m) {
    const q = parseInt(m[1], 10);
    if (q >= 1 && q <= 40) return q;
  }
  return null;
}

function scopeMatches(entry: TreatmentQuantityPrice, requested: QuantityScope): boolean {
  const entryScope = entry.scope ?? "total";
  if (requested === "total") return entryScope === "total";
  return entryScope === requested;
}

export type QuantityPriceResolution =
  | { kind: "exact"; quantity: number; scope: QuantityScope; lines: string[] }
  | { kind: "unknown"; quantity: number; scope: QuantityScope; availableSummary: string }
  | null;

// Casa a quantidade pedida contra os tratamentos com tabela de pacotes.
// - "exact": ao menos um tratamento tem preço para (quantidade, escopo) → valores exatos.
// - "unknown": há tratamentos com pacotes, mas nenhum cobre essa quantidade/escopo →
//   escalonar para a equipe (nunca chutar).
// - null: a mensagem não tem quantidade OU a clínica não usa pacotes por quantidade.
export function resolveQuantityPriceQuery(
  message: string,
  treatments: Treatment[],
): QuantityPriceResolution {
  const packaged = treatments.filter(
    (t) => t.priceQuotableInChat && (t.quantityPrices?.length ?? 0) > 0,
  );
  if (packaged.length === 0) return null;

  const quantity = extractQuantity(message);
  if (quantity === null) return null;

  const scope = detectScope(message);

  const lines: string[] = [];
  for (const t of packaged) {
    const entry = (t.quantityPrices ?? []).find(
      (qp) => qp.quantity === quantity && scopeMatches(qp, scope),
    );
    if (entry) {
      lines.push(`${t.name}: ${formatBrl(entry.priceCents)}`);
    }
  }

  if (lines.length > 0) {
    return { kind: "exact", quantity, scope, lines };
  }

  // Resumo das quantidades disponíveis (para o escalonamento), deduplicado e ordenado.
  const available = Array.from(
    new Set(
      packaged.flatMap((t) =>
        (t.quantityPrices ?? [])
          .filter((qp) => scopeMatches(qp, scope) || scope === "total")
          .map((qp) => qp.quantity),
      ),
    ),
  ).sort((a, b) => a - b);
  const availableSummary = available.join(" ou ");

  return { kind: "unknown", quantity, scope, availableSummary };
}
