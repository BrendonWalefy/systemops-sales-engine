import type { Journey } from "@/application/corpus/corpus-case";

/**
 * Estratificação da amostra de candidatos.
 *
 * **Isto não é rótulo.** É um agrupamento barato, por palavra-chave, cuja única
 * função é evitar que a amostra de ~60 casos saia toda da mesma jornada. O
 * entendimento de cada caso é decidido na revisão, contra os fatos disponíveis,
 * e pode contrariar o palpite daqui sem que isso seja um bug.
 *
 * A distinção importa: a V1 adoeceu justamente por transformar palpite de
 * palavra-chave em decisão. Aqui o palpite escolhe o que ler, nunca o que a
 * resposta deveria ter sido.
 */

export type CorpusCandidate = {
  candidateId: string;
  tenantHash: string;
  conversationHash: string;
  turnIndex: number;
  capturedAt: string;
  leadMessage: string;
  history: Array<{ author: "lead" | "agent" | "operator"; body: string }>;
  aiResponse: string | null;
  humanResponse: string | null;
  /** Intent que a V1 registrou na mensagem, quando registrou. */
  observedIntent: string | null;
  mediaKind: "image" | "video" | "audio" | "document" | null;
  isBurst: boolean;
};

export type StratifiedCandidate = CorpusCandidate & { journey: Journey };

const TEXT_RULES: ReadonlyArray<{ journey: Journey; pattern: RegExp }> = [
  { journey: "objection", pattern: /\b(caro|car[ao]s|muito alto|salgado|apertad|sem condi|fora do meu|pensar melhor|vou ver|t[aá] puxado)\b/i },
  { journey: "discount", pattern: /\b(desconto|abatimento|promo|condi[cç][aã]o especial|parcel|dividir|entrada|10x|12x)\b/i },
  { journey: "price", pattern: /\b(valor|valores|pre[cç]o|quanto (custa|fica|sai|[eé])|or[cç]amento|investimento)\b/i },
  { journey: "comparison", pattern: /\b(diferen[cç]a entre|qual (a )?melhor|ou o|vale mais|compar)\b/i },
  { journey: "reschedule", pattern: /\b(remarc|adiar|cancel|desmarc|transferir (a|minha) )/i },
  { journey: "availability", pattern: /\b(hor[aá]rio|disponibilidade|tem vaga|tem hor|agenda (de|para)|que horas|amanh[aã]|segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado)\b/i },
  { journey: "scheduling", pattern: /\b(agendar|marcar|agendamento|quero marcar|consegue me encaixar)\b/i },
  { journey: "location", pattern: /\b(endere[cç]o|onde (fica|voc[eê]s|[eé])|localiza|como chego|maps|refer[eê]ncia)\b/i },
  { journey: "handoff", pattern: /\b(falar com (uma|um|a|o) (pessoa|atendente|humano|respons)|atendente|algu[eé]m pode|me liga|liga[cç][aã]o)\b/i },
  { journey: "procedure", pattern: /\b(como funciona|o que [eé]|doi|d[oó]i|dura quanto|quantas sess|procedimento|tratamento|anestesia|recupera)\b/i },
  { journey: "ambiguity", pattern: /\b(qual (deles|delas)|n[aã]o entendi|como assim|de qual)\b/i },
  { journey: "follow-up", pattern: /\b(voltando|retomando|ainda estou|continua|falamos (semana|m[eê]s))\b/i },
  { journey: "integration-error", pattern: /\b(n[aã]o recebi|n[aã]o chegou|erro|n[aã]o consigo abrir|link quebrado)\b/i },
];

export function guessJourneyForSampling(candidate: CorpusCandidate): Journey {
  // O que o lead pediu vem primeiro. Mídia e rajada são *modalidades* do turno,
  // não jornadas, e colocá-las na frente sequestra a amostra: na primeira
  // extração real de Vitalli, 368 candidatos caíram em "burst" e sobraram 3 em
  // "objection" — a jornada mais escassa e a que o programa mais precisa medir.
  for (const rule of TEXT_RULES) {
    if (rule.pattern.test(candidate.leadMessage)) return rule.journey;
  }

  if (candidate.mediaKind === "audio") return "audio";
  if (candidate.mediaKind) return "media";
  if (candidate.isBurst) return "burst";
  if (candidate.history.length === 0) return "first-contact";

  // Sobra declarada. O balde de fallback tem de dizer que é fallback: chamá-lo
  // de "procedure" fabricaria milhares de casos de explicação de procedimento
  // que ninguém verificou, e a distribuição do relatório sairia mentindo.
  return "other";
}

/**
 * Escolhe até `quota[journey]` candidatos por jornada, preferindo os turnos mais
 * informativos: primeiro os que têm resposta da IA **e** do humano, depois os
 * que têm só um dos dois.
 *
 * Cota que a jornada não preenche não é compensada em outra jornada. Forçar
 * número produziria caso fabricado, que é pior que jornada sub-representada —
 * e o relatório do ciclo precisa mostrar a distribuição real do banco.
 */
export function selectStratifiedCandidates(
  candidates: CorpusCandidate[],
  quota: Partial<Record<Journey, number>>,
): StratifiedCandidate[] {
  const byJourney = new Map<Journey, StratifiedCandidate[]>();
  for (const candidate of candidates) {
    const journey = guessJourneyForSampling(candidate);
    const bucket = byJourney.get(journey) ?? [];
    bucket.push({ ...candidate, journey });
    byJourney.set(journey, bucket);
  }

  const selected: StratifiedCandidate[] = [];
  for (const [journey, wanted] of Object.entries(quota)) {
    const bucket = byJourney.get(journey as Journey) ?? [];
    const ranked = [...bucket].sort(
      (a, b) => contrastScore(b) - contrastScore(a),
    );
    selected.push(...ranked.slice(0, wanted ?? 0));
  }
  return selected;
}

function contrastScore(candidate: CorpusCandidate): number {
  if (candidate.aiResponse && candidate.humanResponse) return 3;
  if (candidate.humanResponse) return 2;
  if (candidate.aiResponse) return 1;
  return 0;
}
