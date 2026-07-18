// A5/A6 — Detectores determinísticos para casos que a IA hoje trata mal:
//   - Objeção de preço antigo ("vocês me passaram um valor menor antes").
//   - Caso clínico atípico (dente fraturado, só raiz, ponte, prótese, implante) —
//     a IA empurrava o pitch padrão de lentes em vez de fazer a triagem que o doutor
//     precisa (radiografia/foto). Casos reais no histórico da Vitalli (Gaab, Marcel).

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Objeção de preço antigo: o lead lembra de uma cotação anterior mais barata.
// Ex.: "vocês me passaram um valor legal", "ficava 10 de 200", "era mais barato".
// Sinais fortes de "vocês JÁ me cotaram um valor antes". Conservador de propósito:
// verbos genéricos (era/estava/ficava) só contam se acompanhados de referência ao
// passado/promoção — senão "qual era o valor?" (pergunta comum) daria falso positivo.
const OLD_PRICE_RE = new RegExp(
  [
    // "me passaram / tinham me passado ... um valor" (verbo antes do substantivo)
    "\\b(me (passaram|passou|passado|falaram|deram)|tinha[m]? (me )?passado|voces (ja )?(me )?passaram)\\b[^.?!]*\\b(valor|preco|orcamento|promocao|desconto|parcela|barato|menor|legal)\\b",
    // "o valor que vocês tinham me passado" (substantivo antes do verbo)
    "\\bvalor[^.?!]*\\b(tinha[m]? me passado|que voces? (me )?passaram|do ano passado|de antes)\\b",
    // promoção explicitamente antiga
    "\\bpromocao (antiga|passada|de antes|daquela epoca)\\b",
    // "aquele valor era ...", "valor do ano passado"
    "\\b(aquele|o) valor (era|de antes|do ano passado)\\b",
    // era/estava/ficava só com âncora temporal/promocional
    "\\b(era|estava|ficava)\\b[^.?!]*\\b(mais barato|promocao|antes|daquela vez|do ano passado)\\b",
  ].join("|"),
);

export function detectOldPriceObjection(message: string): boolean {
  return OLD_PRICE_RE.test(normalize(message));
}

// Pausa comercial explícita: o lead está pesquisando/comparando e sinaliza que
// voltará depois. Isso não é opt-out, mas também não é autorização para reiniciar
// o pitch, disparar mídia ou continuar um pipeline no mesmo turno.
const COMMERCIAL_PAUSE_RE = [
  /\b(levantamento|levantamentos|levantar|levantando|pesquisando|pesquisar|analisando|analisar|pensando|pensar|avaliando|avaliar|comparando|comparar|valores?|precos?|orcamentos?|cotacoes?)\b[^.?!]{0,120}\b(por enquanto|depois|mais tarde|volto|retorno|te chamo|vou chamar|entro em contato|quando decidir)\b/,
  /\b(por enquanto|depois|mais tarde|volto|retorno|te chamo|vou chamar|entro em contato|quando decidir)\b[^.?!]{0,120}\b(levantamento|levantamentos|levantar|levantando|pesquisando|pesquisar|analisando|analisar|pensando|pensar|avaliando|avaliar|comparando|comparar|valores?|precos?|orcamentos?|cotacoes?)\b/,
];

export function detectCommercialPauseText(message: string): boolean {
  const normalized = normalize(message);
  return COMMERCIAL_PAUSE_RE.some((pattern) => pattern.test(normalized));
}

// Caso clínico atípico: sinais de PROBLEMA ESTRUTURAL que impede o plano padrão de
// lentes e exige avaliação clínica prévia (radiografia/foto) antes de qualquer cotação.
// IMPORTANTE (multi-tenant): NÃO listamos nomes de tratamentos que a clínica pode vender
// normalmente (implante, canal, extração, prótese) — cotá-los é o fluxo normal. Só
// disparamos em sinais de dente comprometido/ausente. Ex. real: Gaab (dentes fraturados,
// só a raiz, dentista indicou ponte fixa) querendo lentes.
const ATYPICAL_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bfratur/, label: "dente fraturado" },
  { re: /\blascad/, label: "dente lascado" },
  { re: /\b(dente quebrado|quebrou o dente|quebrei o dente|quebrado por dentro)\b/, label: "dente quebrado" },
  { re: /\b(so a raiz|somente a raiz|so tem a raiz|so sobrou a raiz|apenas a raiz|so a raizinha|so tenho a raiz)\b/, label: "só a raiz do dente" },
  { re: /\b(ponte fixa|ponte movel|ponte moveu)\b/, label: "ponte indicada" },
  { re: /\b(caiu o dente|caiu um dente|perdi o dente|perdi um dente|nao tenho o dente|nao tenho mais o dente|sem o dente|falta o dente|falta um dente)\b/, label: "dente ausente" },
];

export function detectAtypicalClinicalCase(message: string): string | null {
  const n = normalize(message);
  for (const { re, label } of ATYPICAL_PATTERNS) {
    if (re.test(n)) return label;
  }
  return null;
}
