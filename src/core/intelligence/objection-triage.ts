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

// ── #21 — Relato de dano em trabalho já realizado ──
// "Um dos dentes quebrou", "a lente caiu", "as lentes estão quebrando". Hoje o
// tratamento correto depende da LLM rotular a mensagem como clinical_urgency; quando
// ela rotula outra coisa o lead recebe lista de horários ou cotação do tratamento base.
// Caso real: Carla (Ximendes, 16/07) — lentes estratificadas feitas na casa em 23/06,
// "Um dos dentes quebrou" 23 dias depois → intent reject_slots → 5 horários de segunda.
//
// Dois alvos, com pesos diferentes:
//   "work"  — substantivo de trabalho odontológico (lente, faceta, coroa, prótese):
//             o dano é sobre algo instalado, então é relato por si só.
//   "tooth" — só "dente(s)": ambíguo. Dente natural quebrado é caso clínico novo e
//             quem cuida disso é detectAtypicalClinicalCase. Só vira relato de dano
//             quando há vínculo (consulta anterior no sistema ou autodeclaração).
const DAMAGE_TERMS_RE =
  /\b(quebr(?:ou|ei|ada|ado|adas|ados|ando|aram)|trinc(?:ou|ei|ada|ado|adas|ados|ando)|lasc(?:ou|ei|ada|ado|adas|ados|ando)|rach(?:ou|ada|ado|adas|ados|ando)|descol(?:ou|ada|ado|adas|ados|ando|aram)|solt(?:ou|ando|aram)|caiu|cairam|caindo|saiu|sairam|manchou|manchada|manchadas|amarelou|escureceu|estragou|estragada|estragadas|danificou|danificada|danificadas)\b/g;

const DENTAL_WORK_NOUNS_RE =
  /\b(lente|lentes|faceta|facetas|coroa|coroas|protese|proteses|restauracao|restauracoes|resina|resinas|implante|implantes|pino|pinos|provisorio|provisorios|contencao|aparelho)\b/g;

const TOOTH_NOUNS_RE = /\b(dente|dentes|dentinho)\b/g;

// Distância máxima, em caracteres, entre o substantivo e o termo de dano para que
// contem como o mesmo relato. Sem essa janela, "valor para fazer resina em 10 dentes
// superiores […] estou com um dia dentes lascado" (Ana Paula, 18/07 — pergunta de
// preço legítima) viraria relato de dano e mataria a venda.
const DAMAGE_PROXIMITY_CHARS = 40;

type TermHit = { term: string; start: number; end: number };

function collectHits(text: string, re: RegExp): TermHit[] {
  return [...text.matchAll(re)].map((m) => ({
    term: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

function closestPair(a: TermHit[], b: TermHit[]): { gap: number; a: TermHit; b: TermHit } | null {
  let best: { gap: number; a: TermHit; b: TermHit } | null = null;
  for (const x of a) {
    for (const y of b) {
      const gap = x.start >= y.end ? x.start - y.end : y.start >= x.end ? y.start - x.end : 0;
      if (!best || gap < best.gap) best = { gap, a: x, b: y };
    }
  }
  return best;
}

export type ExistingWorkProblem = {
  /** "lente quebrou" — rótulo curto para a nota do operador. */
  label: string;
  target: "work" | "tooth";
};

export function detectExistingWorkProblem(message: string): ExistingWorkProblem | null {
  const n = normalize(message);
  const damage = collectHits(n, DAMAGE_TERMS_RE);
  if (damage.length === 0) return null;

  const work = closestPair(collectHits(n, DENTAL_WORK_NOUNS_RE), damage);
  const tooth = closestPair(collectHits(n, TOOTH_NOUNS_RE), damage);

  // Vale o substantivo MAIS PRÓXIMO do termo de dano — é a ele que o dano se
  // refere. Preferir "trabalho" só porque a palavra existe na frase inverte o
  // sentido de mensagens reais: "só quero fazer as lentes, mas terei que remover
  // 2 dentes quebrados" (ST, Vitalli 19/07) e "restaurações nesses dentes, alem
  // de um quebrado […] as lentes resolvem isso?" (Marta, 21/07) são perguntas de
  // venda sobre dente natural, não relatos de lente quebrada. Empate vai para
  // trabalho, que é o alvo mais específico.
  const best = !work ? tooth : !tooth ? work : tooth.gap < work.gap ? tooth : work;
  if (!best || best.gap > DAMAGE_PROXIMITY_CHARS) return null;
  return {
    label: `${best.a.term} ${best.b.term}`,
    target: best === work ? "work" : "tooth",
  };
}

// Vínculo declarado pelo próprio lead: "troquei minhas lentes com vcs", "vocês
// fizeram", "sou paciente de vocês". Necessário porque o histórico no banco só
// existe desde que a clínica entrou no sistema (Ximendes 27/05, Vitalli 09/07) —
// quem fez lentes há 9 meses é paciente da casa sem nenhuma consulta registrada.
// Caso real: Mô (Vitalli, 14/07) — "troquei minhas lentes de resina com vcs lá na
// av Sabará tem aproximadamente 9 meses […] a maioria das lentes estão quebrando".
//
// Conservador de propósito: "queria refazê-la com vocês" (Felipe, Ximendes) é
// intenção futura, não vínculo — não casa, e o lead cai no ramo que pergunta.
const SELF_DECLARED_PAST_WORK_RE = [
  /\b(fiz|refiz|coloquei|troquei|apliquei|tratei|operei)\b[^.?!]{0,60}\b(com voces|com vcs|com vc|com o dr|com a dra|com o doutor|com a doutora|ai na clinica|aqui na clinica|nessa clinica|nesta clinica)\b/,
  /\b(voces|vcs)\b[^.?!]{0,40}\b(fizeram|fez|colocaram|colocou|trocaram|trocou|refizeram|instalaram)\b/,
  /\b(sou|ja sou|fui|era) (paciente|cliente)\b/,
  // Resposta à pergunta de origem ("foi feito aqui com a gente?"): "foi aí sim",
  // "fiz aqui mesmo". Verbo obrigatório antes do advérbio para não casar com
  // "quebrou aqui em casa".
  /\b(foi|fiz|fizeram|coloquei|troquei)\b[^.?!]{0,20}\b(ai|aqui)\b/,
];

export function detectSelfDeclaredPastWork(message: string): boolean {
  const n = normalize(message);
  return SELF_DECLARED_PAST_WORK_RE.some((re) => re.test(n));
}
