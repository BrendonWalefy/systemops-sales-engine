/**
 * Motor de Reativação (ADR-009), Fase 1.
 *
 * Classifica *por que* um lead não fechou, lendo a conversa. Módulo puro: monta
 * o prompt e valida a resposta. Nenhum I/O — quem chama o LLM e persiste é
 * `src/application/reactivation/classify-lead-outcomes.ts`.
 *
 * A evidência (trecho literal da conversa) não é decoração: é o que torna a
 * classificação auditável pela clínica, e foi pedido explícito do cliente que
 * originou a feature. Por isso o trecho devolvido pelo modelo é *verificado*
 * contra as mensagens reais aqui — se o modelo parafraseou ou inventou, a
 * classificação perde a âncora e a confiança é rebaixada (ver
 * `UNVERIFIED_EVIDENCE_CONFIDENCE_CAP`).
 */

export const LEAD_OUTCOME_REASONS = [
  "price",
  "schedule",
  "location",
  "fear",
  "third_party_decision",
  "competitor",
  "treatment_mismatch",
  "no_response",
  "already_treated",
  "other",
] as const;

export type LeadOutcomeReason = (typeof LEAD_OUTCOME_REASONS)[number];

/** Rótulos em português para relatórios e UI. */
export const LEAD_OUTCOME_REASON_LABELS: Record<LeadOutcomeReason, string> = {
  price: "Achou caro / não cabia no orçamento",
  schedule: "Agenda / horário incompatível",
  location: "Distância ou localização",
  fear: "Medo, dor ou insegurança com o procedimento",
  third_party_decision: "Depende de outra pessoa para decidir",
  competitor: "Foi para outra clínica",
  treatment_mismatch: "Não era o tratamento certo para o caso",
  no_response: "Sumiu sem dar motivo",
  already_treated: "Já fez / já tinha resolvido",
  other: "Outro motivo",
};

export type ClassifierMessage = {
  id: string;
  /** "lead" | "agent" | "clinic_user" — demais autores são ignorados. */
  author: string;
  body: string | null;
};

export type LeadOutcomeClassifierInput = {
  clinicName: string;
  specialty: string;
  leadName: string | null;
  treatmentInterest: string | null;
  messages: ClassifierMessage[];
};

export type LeadOutcomeClassification = {
  reason: LeadOutcomeReason;
  evidenceExcerpt: string | null;
  /** Preenchido só quando o trecho foi localizado numa mensagem real do lead. */
  evidenceMessageId: string | null;
  confidence: number;
};

/** Janela de contexto da classificação. */
export const MAX_CLASSIFIER_MESSAGES = 24;

/** Corte de caracteres por mensagem — conversas longas não podem estourar custo. */
const MAX_CHARS_PER_MESSAGE = 400;

/**
 * Teto de confiança quando a evidência não foi localizada em nenhuma mensagem
 * do lead. Não zeramos: a classificação pode estar certa mesmo com o trecho
 * parafraseado. Mas ela deixa de ser auto-aplicável e cai para revisão humana.
 */
export const UNVERIFIED_EVIDENCE_CONFIDENCE_CAP = 50;

/** Abaixo disso a UI trata como sugestão, não como fato. */
export const LOW_CONFIDENCE_THRESHOLD = 60;

const REASON_GUIDE = `- price: falou em valor, preço, "tá caro", parcelamento, orçamento, "vou ver se cabe"
- schedule: não conseguiu horário, agenda cheia, horário não bate com trabalho/rotina
- location: distância, difícil chegar, estacionamento, mudou de cidade
- fear: medo de dor, insegurança com o procedimento, receio do resultado
- third_party_decision: precisa falar com cônjuge, mãe, pai, sócio, responsável financeiro
- competitor: mencionou outra clínica, outro profissional, ou que já fechou em outro lugar
- treatment_mismatch: não era o procedimento certo para o caso dele, ou foi desaconselhado
- no_response: engajou e simplesmente parou de responder, sem dar nenhum motivo
- already_treated: já tinha feito o procedimento, ou o problema já estava resolvido
- other: motivo claro na conversa que não cabe em nenhum dos anteriores`;

function formatTranscript(messages: ClassifierMessage[]): string {
  return messages
    .filter((m) => typeof m.body === "string" && m.body.trim().length > 0)
    .slice(-MAX_CLASSIFIER_MESSAGES)
    .map((m, index) => {
      const who = m.author === "lead" ? "LEAD" : "CLÍNICA";
      const body = (m.body ?? "").trim().slice(0, MAX_CHARS_PER_MESSAGE);
      return `[${index + 1}] ${who}: ${body}`;
    })
    .join("\n");
}

export function buildLeadOutcomePrompt(input: LeadOutcomeClassifierInput): string {
  const transcript = formatTranscript(input.messages);

  return `Você analisa conversas de atendimento da ${input.clinicName}, clínica de ${input.specialty}, para entender por que um paciente em potencial NÃO fechou.

${input.leadName ? `NOME DO LEAD: ${input.leadName}\n` : ""}${input.treatmentInterest ? `INTERESSE DEMONSTRADO: ${input.treatmentInterest}\n` : ""}
CONVERSA:
${transcript}

MOTIVOS POSSÍVEIS (escolha exatamente um):
${REASON_GUIDE}

REGRAS:
- Escolha o motivo com base no que está ESCRITO na conversa, não no que você imagina.
- "evidence_excerpt" deve ser um trecho COPIADO LITERALMENTE de uma mensagem do LEAD, entre 3 e 200 caracteres. Não parafraseie, não junte pedaços de mensagens diferentes, não escreva nada de sua autoria.
- Se nenhuma mensagem do lead justifica o motivo, use "no_response" e deixe "evidence_excerpt" como null.
- "confidence" é de 0 a 100: 90+ quando o lead disse o motivo com todas as letras; 60-89 quando está claro pelo contexto; abaixo de 60 quando é palpite.
- Se o lead JÁ agendou ou fechou, responda com reason "other", confidence 0 e evidence_excerpt null.

Responda APENAS com JSON, sem texto ao redor:
{"reason": "<motivo>", "evidence_excerpt": "<trecho literal ou null>", "confidence": <0-100>}`;
}

/** Normaliza para comparar trecho x mensagem sem tropeçar em espaço e acento. */
function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Localiza o trecho numa mensagem do lead. Retorna o id da mensagem, ou null
 * quando o modelo não copiou de fato (parafraseou, inventou, ou citou a clínica
 * em vez do lead).
 */
function findEvidenceMessageId(
  excerpt: string,
  messages: ClassifierMessage[],
): string | null {
  const needle = normalizeForMatch(excerpt);
  if (needle.length < 3) return null;

  const match = messages.find(
    (m) =>
      m.author === "lead" &&
      typeof m.body === "string" &&
      normalizeForMatch(m.body).includes(needle),
  );

  return match?.id ?? null;
}

function isLeadOutcomeReason(value: unknown): value is LeadOutcomeReason {
  return (
    typeof value === "string" &&
    (LEAD_OUTCOME_REASONS as readonly string[]).includes(value)
  );
}

function extractJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/**
 * Valida a resposta do modelo contra as mensagens reais.
 *
 * Retorna null quando a resposta é inaproveitável — o caller registra a falha e
 * segue para o próximo lead. Gravar um motivo inventado seria pior que não
 * gravar nada: a clínica dispararia uma oferta com base em ficção.
 */
export function parseLeadOutcomeResponse(
  raw: string,
  messages: ClassifierMessage[],
): LeadOutcomeClassification | null {
  const parsed = extractJsonObject(raw);
  if (parsed === null || typeof parsed !== "object") return null;

  const record = parsed as Record<string, unknown>;
  if (!isLeadOutcomeReason(record.reason)) return null;

  const rawConfidence = Number(record.confidence);
  const confidence = Number.isFinite(rawConfidence)
    ? Math.min(100, Math.max(0, Math.round(rawConfidence)))
    : 0;

  const rawExcerpt =
    typeof record.evidence_excerpt === "string"
      ? record.evidence_excerpt.trim()
      : "";

  if (rawExcerpt.length === 0) {
    return {
      reason: record.reason,
      evidenceExcerpt: null,
      evidenceMessageId: null,
      // Sem evidência, "no_response" é uma conclusão legítima; qualquer outro
      // motivo sem trecho que o sustente é palpite e vai para revisão.
      confidence:
        record.reason === "no_response"
          ? confidence
          : Math.min(confidence, UNVERIFIED_EVIDENCE_CONFIDENCE_CAP),
    };
  }

  const evidenceMessageId = findEvidenceMessageId(rawExcerpt, messages);

  return {
    reason: record.reason,
    evidenceExcerpt: rawExcerpt.slice(0, 500),
    evidenceMessageId,
    confidence:
      evidenceMessageId === null
        ? Math.min(confidence, UNVERIFIED_EVIDENCE_CONFIDENCE_CAP)
        : confidence,
  };
}
