/**
 * Motor de Reativação (ADR-009) — estágio do silêncio.
 *
 * Responde "o que estava na mesa quando a pessoa parou de responder".
 *
 * Existe porque a classificação de motivo sozinha não bastou. Rodando em
 * produção, 82 de 94 leads vieram como `no_response` — factualmente correto
 * (94% deles tiveram a clínica falando por último, ou seja, a pessoa realmente
 * sumiu), mas inútil para segmentar: não diz por quê.
 *
 * O detalhe que faltava estava no histórico, não na cabeça do modelo. Dos
 * mesmos 82: 35 sumiram **depois de ver um valor** e 7 **perguntaram preço e
 * nunca receberam resposta**. Enquanto o filtro `price` do LLM, com a confiança
 * mínima padrão, pegava **zero**.
 *
 * Por isso isto é **determinístico**, não uma segunda pergunta ao LLM: o
 * estágio é um fato verificável sobre as mensagens. O motivo é julgamento e
 * continua com o modelo; o estágio é dado e fica no código. Mesma divisão do
 * AGENTS.md — o sistema decide, a LLM verbaliza.
 */

export const SILENCE_STAGES = [
  /** A clínica cotou um valor e a pessoa não voltou. Público de oferta. */
  "after_quote",
  /** A pessoa perguntou preço e nunca recebeu um valor. Falha nossa, não recusa dela. */
  "price_unanswered",
  /** Horários foram oferecidos e a pessoa não escolheu. */
  "after_slots",
  /** A última palavra é da pessoa — ela está esperando a clínica. */
  "awaiting_clinic",
  /** Conversa parou antes de chegar a preço ou agenda. */
  "early",
] as const;

export type SilenceStage = (typeof SILENCE_STAGES)[number];

export const SILENCE_STAGE_LABELS: Record<SilenceStage, string> = {
  after_quote: "Viu o valor e sumiu",
  price_unanswered: "Perguntou o preço e não foi respondida",
  after_slots: "Recebeu horários e não escolheu",
  awaiting_clinic: "Está esperando a clínica responder",
  early: "Parou antes de falar de preço ou agenda",
};

export type StageMessage = {
  author: string;
  body: string | null;
};

/**
 * Títulos das mídias que entregam preço na clínica (ex.: "Valores Lente em
 * Resina Premium").
 *
 * A Aurora manda os valores em arte — decisão do dentista, não falha. Mas a
 * imagem é gravada em `messages` com `delivery_format = 'text'` e o **título da
 * mídia no corpo**; o valor está dentro do arquivo. Procurar "R$" no texto,
 * portanto, não vê o preço que o paciente de fato recebeu.
 *
 * Sem isto, conversas em que a pessoa recebeu a tabela completa de pacotes eram
 * marcadas como "perguntou e não foi respondida".
 */
export type PriceMediaTitles = ReadonlySet<string>;

// ATENÇÃO: todos os padrões abaixo são testados contra texto JÁ NORMALIZADO
// (sem acento, ver `normalize`). Escrever "às" ou "preço" aqui nunca casaria —
// foi o que quebrou o primeiro teste de horário em texto solto.

/** Um valor em reais dito pela clínica. Aceita "R$ 1.200" e "R$1200,00". */
const QUOTE_PATTERN = /r\$\s*\d/i;

/** A pessoa perguntando quanto custa, em português de WhatsApp. */
const PRICE_QUESTION_PATTERN =
  /(quanto\s+(custa|fica|sai|e)\b|qual\s+(o\s+)?(valor|preco)|valores?\b|precos?\b|orcamento|investimento)/i;

/**
 * Oferta de horário. Casa tanto a lista numerada do menu ("Sex 17/07 às 15h")
 * quanto texto solto ("tenho quinta às 14h"). Deliberadamente conservador:
 * falso positivo aqui classificaria como `after_slots` quem nunca viu agenda.
 */
const SLOTS_PATTERN =
  /(seg|ter|qua|qui|sex|sab|dom)[a-z]*\s+\d{1,2}\/\d{1,2}|as?\s+\d{1,2}\s*(h\b|h\d|:)|horarios?\s+disponive/i;

function normalize(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Calcula o estágio a partir das mensagens em ordem cronológica.
 *
 * A ordem das checagens é a prioridade de leitura comercial:
 *  1. Esperando a clínica vence tudo — se a bola é nossa, o resto é ruído.
 *  2. Viu um valor e sumiu — sinal mais forte para campanha com oferta.
 *  3. Perguntou preço sem resposta — falha operacional, não recusa.
 *  4. Recebeu horários e não escolheu.
 *  5. Parou antes de qualquer um desses.
 */
export function computeSilenceStage(
  messages: StageMessage[],
  priceMediaTitles: PriceMediaTitles = new Set(),
): SilenceStage {
  const relevantes = messages.filter(
    (m) => typeof m.body === "string" && m.body.trim().length > 0,
  );
  if (relevantes.length === 0) return "early";

  const ultima = relevantes[relevantes.length - 1];
  if (ultima.author === "lead") return "awaiting_clinic";

  const daClinica = relevantes.filter((m) => m.author !== "lead");
  const doLead = relevantes.filter((m) => m.author === "lead");

  // Preço em texto OU entregue por imagem — ver PriceMediaTitles.
  const clinicaCotou = daClinica.some(
    (m) =>
      QUOTE_PATTERN.test(normalize(m.body)) ||
      priceMediaTitles.has((m.body ?? "").trim()),
  );
  if (clinicaCotou) return "after_quote";

  const leadPerguntouPreco = doLead.some((m) =>
    PRICE_QUESTION_PATTERN.test(normalize(m.body)),
  );
  if (leadPerguntouPreco) return "price_unanswered";

  const ofereceuHorarios = daClinica.some((m) => SLOTS_PATTERN.test(normalize(m.body)));
  if (ofereceuHorarios) return "after_slots";

  return "early";
}
