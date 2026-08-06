/**
 * Motor de Reativação (ADR-009), Fase 2 — redação do rascunho de campanha.
 *
 * Módulo puro: monta o prompt e valida a saída. Sem I/O.
 *
 * O guardrail do AGENTS.md vale inteiro aqui — **o sistema decide, a LLM
 * verbaliza**. Qual oferta, qual preço e qual prazo vêm de dado (`price_campaigns`,
 * `deadlineAt`); a LLM só escolhe as palavras. E isso não é confiado ao prompt:
 * `validateDraft` recusa qualquer rascunho que cite um valor em reais que não
 * seja exatamente o da oferta. Uma IA que inventa "R$ 800" numa campanha de
 * recuperação de preço cria uma obrigação comercial que a clínica não assumiu.
 */

export type ReactivationOffer = {
  /** Nome do tratamento a que a oferta se aplica. */
  treatmentName: string;
  /** Texto do preço já formatado pelo sistema (ex.: "R$ 1.200"). */
  priceLabel: string;
  /** Rótulo da campanha de preço, como a clínica cadastrou. */
  campaignName: string;
};

export type ReactivationMessageInput = {
  clinicName: string;
  receptionistName: string;
  specialty: string;
  leadName: string | null;
  treatmentInterest: string | null;
  /** Motivo pelo qual não fechou, se classificado. */
  outcomeReason: string | null;
  /** Trecho literal do que o lead disse — ancora a mensagem no que aconteceu. */
  evidenceExcerpt: string | null;
  /** Oferta, quando a campanha tem uma. */
  offer: ReactivationOffer | null;
  /** Prazo em texto já formatado pelo sistema (ex.: "sexta-feira, 24/07"). */
  deadlineLabel: string | null;
  /** Últimas mensagens da conversa, mais antiga primeiro. */
  recentMessages: Array<{ author: string; body: string | null }>;
};

export type DraftValidation =
  | { ok: true; text: string }
  | { ok: false; reason: DraftRejectionReason };

export type DraftRejectionReason =
  | "vazio"
  | "muito_longo"
  | "preco_nao_autorizado"
  | "placeholder_nao_preenchido"
  | "prazo_inventado";

export const MAX_DRAFT_LENGTH = 600;
const MAX_HISTORY_MESSAGES = 8;
const MAX_CHARS_PER_MESSAGE = 200;

const REASON_HINTS: Record<string, string> = {
  price: "o valor foi o que travou — reconheça isso sem constranger",
  schedule: "o horário foi o problema — ofereça flexibilidade",
  location: "a distância pesou — seja prático",
  fear: "havia insegurança com o procedimento — acolha, não empurre",
  third_party_decision: "a decisão dependia de outra pessoa — facilite essa conversa",
  competitor: "considerou outro lugar — não critique o concorrente",
  treatment_mismatch: "o procedimento não era o ideal — foque no que faz sentido",
  no_response: "a conversa simplesmente parou — retome com leveza",
  already_treated: "já tinha resolvido — não insista no mesmo procedimento",
  other: "sem motivo claro — retome pelo interesse demonstrado",
};

function formatHistory(messages: ReactivationMessageInput["recentMessages"]): string {
  return messages
    .filter((m) => typeof m.body === "string" && m.body.trim().length > 0)
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => {
      const who = m.author === "lead" ? "LEAD" : "CLÍNICA";
      return `${who}: ${(m.body ?? "").trim().slice(0, MAX_CHARS_PER_MESSAGE)}`;
    })
    .join("\n");
}

export function buildReactivationMessagePrompt(input: ReactivationMessageInput): string {
  const hint = input.outcomeReason ? REASON_HINTS[input.outcomeReason] : null;

  const blocoOferta = input.offer
    ? `OFERTA AUTORIZADA (use exatamente estes valores, não invente outros):
- Tratamento: ${input.offer.treatmentName}
- Valor: ${input.offer.priceLabel}
- Campanha: ${input.offer.campaignName}`
    : `SEM OFERTA: não mencione preço, desconto, condição especial nem valores.`;

  const blocoPrazo = input.deadlineLabel
    ? `PRAZO AUTORIZADO: ${input.deadlineLabel}. Mencione esse prazo uma vez, sem pressionar.`
    : `SEM PRAZO: não invente urgência, não diga "por tempo limitado" nem "últimas vagas".`;

  return `Você é ${input.receptionistName}, especialista comercial com IA da ${input.clinicName} (${input.specialty}).

Escreva UMA mensagem de WhatsApp para retomar contato com ${input.leadName ?? "esta pessoa"}, que conversou com a clínica e não fechou.

${input.treatmentInterest ? `INTERESSE: ${input.treatmentInterest}\n` : ""}${hint ? `POR QUE NÃO FECHOU: ${hint}\n` : ""}${input.evidenceExcerpt ? `O QUE ELA DISSE: "${input.evidenceExcerpt}"\n` : ""}
TRECHO DA CONVERSA:
${formatHistory(input.recentMessages)}

${blocoOferta}

${blocoPrazo}

REGRAS:
- No máximo 4 frases. Mensagem de WhatsApp, não e-mail.
- Comece pelo nome da pessoa se você o tem.
- Retome pelo que ELA demonstrou interesse, com naturalidade.
- NÃO diga que houve demora, falha ou sumiço — nem dela, nem da clínica.
- NÃO invente valores, descontos, datas ou horários que não estejam acima.
- NÃO ofereça horário específico nem confirme agendamento — isso é passo seguinte.
- Tom: acolhedor e direto. Sem emoji em excesso (no máximo um).
- Não use colchetes, chaves nem marcadores de preenchimento.

Responda APENAS com o texto da mensagem, sem aspas e sem comentários.`;
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Expressões de urgência que só são legítimas quando a clínica definiu prazo. */
const URGENCY_PATTERN =
  /(ultimas?\s+vagas?|ultimas?\s+unidades?|por\s+tempo\s+limitado|so\s+(hoje|ate)|termina\s+(hoje|amanha)|corre\s+que\s+acaba|vagas?\s+limitadas?)/i;

/** Todos os valores em reais citados no texto, normalizados para comparação. */
export function extractMoneyMentions(text: string): string[] {
  const matches = text.match(/R\$\s*[\d.,]+/gi) ?? [];
  return matches.map(normalizeMoney);
}

function normalizeMoney(value: string): string {
  return value.replace(/\s+/g, "").replace(/,00$/, "").toLowerCase();
}

/**
 * Recusa o rascunho quando ele extrapola o que o sistema autorizou.
 *
 * Chega antes de qualquer olho humano: um rascunho recusado não é mostrado como
 * pronto na tela de revisão, evitando que o operador aprove no automático um
 * texto com preço inventado.
 */
export function validateDraft(
  raw: string,
  input: Pick<ReactivationMessageInput, "offer" | "deadlineLabel">,
): DraftValidation {
  const text = raw.trim().replace(/^["']|["']$/g, "").trim();

  if (text.length === 0) return { ok: false, reason: "vazio" };
  if (text.length > MAX_DRAFT_LENGTH) return { ok: false, reason: "muito_longo" };

  // Marcadores de preenchimento que vazaram do prompt.
  if (/\[[^\]]{2,30}\]|\{\{?[^}]{2,30}\}?\}/.test(text)) {
    return { ok: false, reason: "placeholder_nao_preenchido" };
  }

  const citados = extractMoneyMentions(text);
  if (citados.length > 0) {
    if (!input.offer) {
      // Campanha sem oferta não pode citar preço nenhum.
      return { ok: false, reason: "preco_nao_autorizado" };
    }
    const autorizado = normalizeMoney(input.offer.priceLabel);
    if (citados.some((v) => v !== autorizado)) {
      return { ok: false, reason: "preco_nao_autorizado" };
    }
  }

  // Urgência inventada quando não há prazo definido pela clínica.
  // Compara sem acento: `\b` do regex JS é ASCII e não casa antes de "Ú",
  // então "Últimas vagas" escaparia da checagem acentuada.
  if (!input.deadlineLabel && URGENCY_PATTERN.test(stripAccents(text))) {
    return { ok: false, reason: "prazo_inventado" };
  }

  return { ok: true, text };
}

export const DRAFT_REJECTION_LABELS: Record<DraftRejectionReason, string> = {
  vazio: "A IA não gerou texto.",
  muito_longo: "Mensagem longa demais para WhatsApp.",
  preco_nao_autorizado: "A IA citou um valor que não é o da oferta cadastrada.",
  placeholder_nao_preenchido: "Sobrou marcador de preenchimento no texto.",
  prazo_inventado: "A IA inventou urgência sem prazo definido pela clínica.",
};
