/**
 * Motor de Reativação (ADR-009), Fase 2 — definição declarativa de audiência.
 *
 * Um segmento responde "quem entra nesta campanha". É dado, não código: fica
 * em jsonb na campanha, é versionável, e a mesma definição serve para o preview
 * e para a materialização dos alvos. Preview e disparo divergirem seria o pior
 * furo possível — a clínica aprova 40 e o sistema manda para 300.
 *
 * Duas categorias de filtro, com pesos diferentes:
 *
 *  - **Seleção** (janela, motivo, status, tratamento): a clínica escolhe.
 *    Errar aqui produz uma campanha ruim.
 *  - **Exclusões de segurança** (opt-out, agendamento ativo, contato recente,
 *    cap de vida): sempre aplicadas. Errar aqui produz spam, denúncia e número
 *    banido. Por isso não são opcionais — só os limites numéricos são ajustáveis,
 *    e dentro de faixas.
 */

import { LEAD_OUTCOME_REASONS, type LeadOutcomeReason } from "@/core/intelligence/LeadOutcomeClassifier";
import { SILENCE_STAGES, type SilenceStage } from "@/core/intelligence/silence-stage";

export const SEGMENTABLE_LEAD_STATUSES = [
  "new",
  "waiting_response",
  "in_conversation",
  "follow_up_due",
  "lost",
] as const;

export type SegmentableLeadStatus = (typeof SEGMENTABLE_LEAD_STATUSES)[number];

export type AudienceSegment = {
  /** Limite mais ANTIGO da janela, em dias atrás. 14 = "até duas semanas atrás". */
  windowFromDaysAgo: number;
  /** Limite mais RECENTE da janela, em dias atrás. 0 = até hoje. */
  windowToDaysAgo: number;
  /** Motivos de não-fechamento aceitos. Vazio/ausente = qualquer motivo. */
  outcomeReasons?: LeadOutcomeReason[];
  /**
   * Estágio do silêncio — o que estava na mesa quando a pessoa parou.
   *
   * É o filtro que faz a campanha do preço existir de verdade. Em produção o
   * motivo `price` pegava 1 pessoa, porque quase ninguém escreve "achou caro"
   * antes de sumir; `silenceStages: ["after_quote"]` pega as 17 que viram um
   * valor e não voltaram. Ver `silence-stage.ts`.
   */
  silenceStages?: SilenceStage[];
  /** Status de lead aceitos. Vazio/ausente = todos os segmentáveis. */
  leadStatuses?: SegmentableLeadStatus[];
  /** Confiança mínima da classificação (0-100). Protege contra oferta baseada em palpite. */
  minConfidence?: number;
  /** Não incluir quem recebeu mensagem proativa nos últimos N dias. */
  excludeContactedWithinDays: number;
  /** Máximo de campanhas de reativação que um lead pode ter recebido na vida. */
  lifetimeCampaignCap: number;
};

/**
 * Defaults conservadores de propósito. É mais fácil a clínica afrouxar
 * conscientemente do que descobrir que mandou demais.
 */
export const DEFAULT_SEGMENT: AudienceSegment = {
  windowFromDaysAgo: 30,
  windowToDaysAgo: 2,
  minConfidence: 60,
  excludeContactedWithinDays: 7,
  lifetimeCampaignCap: 3,
};

/** Nunca menos que isto entre duas mensagens proativas para o mesmo lead. */
export const MIN_EXCLUDE_CONTACTED_WITHIN_DAYS = 3;
/** Teto de vida absoluto, mesmo que a clínica peça mais. */
export const MAX_LIFETIME_CAMPAIGN_CAP = 5;
export const MAX_WINDOW_DAYS_AGO = 365;

/**
 * Distância mínima entre o fim da janela e agora. Conversa de ontem ainda pode
 * estar viva; mandar oferta de recuperação nela atropela o atendimento em curso.
 */
export const MIN_WINDOW_TO_DAYS_AGO = 2;

export type SegmentValidationError = { field: string; message: string };

export function validateSegment(segment: AudienceSegment): SegmentValidationError[] {
  const errors: SegmentValidationError[] = [];

  if (!Number.isInteger(segment.windowFromDaysAgo) || segment.windowFromDaysAgo <= 0) {
    errors.push({
      field: "windowFromDaysAgo",
      message: "O início da janela precisa ser um número inteiro de dias maior que zero.",
    });
  } else if (segment.windowFromDaysAgo > MAX_WINDOW_DAYS_AGO) {
    errors.push({
      field: "windowFromDaysAgo",
      message: `A janela não pode passar de ${MAX_WINDOW_DAYS_AGO} dias.`,
    });
  }

  if (!Number.isInteger(segment.windowToDaysAgo) || segment.windowToDaysAgo < 0) {
    errors.push({
      field: "windowToDaysAgo",
      message: "O fim da janela precisa ser um número inteiro de dias não negativo.",
    });
  } else if (segment.windowToDaysAgo < MIN_WINDOW_TO_DAYS_AGO) {
    errors.push({
      field: "windowToDaysAgo",
      message: `Deixe pelo menos ${MIN_WINDOW_TO_DAYS_AGO} dias de folga — conversa recente ainda pode estar viva.`,
    });
  }

  if (
    Number.isInteger(segment.windowFromDaysAgo) &&
    Number.isInteger(segment.windowToDaysAgo) &&
    segment.windowFromDaysAgo <= segment.windowToDaysAgo
  ) {
    errors.push({
      field: "windowFromDaysAgo",
      message: "O início da janela precisa ser mais antigo que o fim.",
    });
  }

  if (segment.outcomeReasons !== undefined) {
    if (!Array.isArray(segment.outcomeReasons)) {
      errors.push({ field: "outcomeReasons", message: "Motivos precisam ser uma lista." });
    } else {
      const invalidos = segment.outcomeReasons.filter(
        (r) => !(LEAD_OUTCOME_REASONS as readonly string[]).includes(r),
      );
      if (invalidos.length > 0) {
        errors.push({
          field: "outcomeReasons",
          message: `Motivo desconhecido: ${invalidos.join(", ")}.`,
        });
      }
    }
  }

  if (segment.silenceStages !== undefined) {
    if (!Array.isArray(segment.silenceStages)) {
      errors.push({ field: "silenceStages", message: "Estágios precisam ser uma lista." });
    } else {
      const invalidos = segment.silenceStages.filter(
        (s) => !(SILENCE_STAGES as readonly string[]).includes(s),
      );
      if (invalidos.length > 0) {
        errors.push({
          field: "silenceStages",
          message: `Estágio desconhecido: ${invalidos.join(", ")}.`,
        });
      }
    }
  }

  if (segment.leadStatuses !== undefined) {
    if (!Array.isArray(segment.leadStatuses)) {
      errors.push({ field: "leadStatuses", message: "Status precisam ser uma lista." });
    } else {
      const invalidos = segment.leadStatuses.filter(
        (s) => !(SEGMENTABLE_LEAD_STATUSES as readonly string[]).includes(s),
      );
      if (invalidos.length > 0) {
        errors.push({
          field: "leadStatuses",
          // "won" e "appointment_scheduled" não são segmentáveis por construção:
          // quem fechou não é público de campanha de recuperação.
          message: `Status não permitido em campanha de reativação: ${invalidos.join(", ")}.`,
        });
      }
    }
  }

  if (segment.minConfidence !== undefined) {
    if (
      !Number.isInteger(segment.minConfidence) ||
      segment.minConfidence < 0 ||
      segment.minConfidence > 100
    ) {
      errors.push({
        field: "minConfidence",
        message: "A confiança mínima precisa ser um inteiro entre 0 e 100.",
      });
    }
  }

  if (
    !Number.isInteger(segment.excludeContactedWithinDays) ||
    segment.excludeContactedWithinDays < MIN_EXCLUDE_CONTACTED_WITHIN_DAYS
  ) {
    errors.push({
      field: "excludeContactedWithinDays",
      message: `Espere pelo menos ${MIN_EXCLUDE_CONTACTED_WITHIN_DAYS} dias entre mensagens proativas para o mesmo contato.`,
    });
  }

  if (
    !Number.isInteger(segment.lifetimeCampaignCap) ||
    segment.lifetimeCampaignCap < 1 ||
    segment.lifetimeCampaignCap > MAX_LIFETIME_CAMPAIGN_CAP
  ) {
    errors.push({
      field: "lifetimeCampaignCap",
      message: `O limite de campanhas por contato precisa ficar entre 1 e ${MAX_LIFETIME_CAMPAIGN_CAP}.`,
    });
  }

  return errors;
}

/**
 * Normaliza entrada crua (formulário, jsonb do banco) num segmento válido.
 * Devolve os erros em vez de lançar — quem chama decide se é 400 ou fallback.
 */
export function parseSegment(
  raw: unknown,
): { segment: AudienceSegment; errors: SegmentValidationError[] } {
  const input = (raw ?? {}) as Partial<AudienceSegment>;

  const segment: AudienceSegment = {
    windowFromDaysAgo: toInt(input.windowFromDaysAgo, DEFAULT_SEGMENT.windowFromDaysAgo),
    windowToDaysAgo: toInt(input.windowToDaysAgo, DEFAULT_SEGMENT.windowToDaysAgo),
    outcomeReasons: Array.isArray(input.outcomeReasons)
      ? (input.outcomeReasons as LeadOutcomeReason[])
      : undefined,
    leadStatuses: Array.isArray(input.leadStatuses)
      ? (input.leadStatuses as SegmentableLeadStatus[])
      : undefined,
    silenceStages: Array.isArray(input.silenceStages)
      ? (input.silenceStages as SilenceStage[])
      : undefined,
    minConfidence:
      input.minConfidence === undefined
        ? DEFAULT_SEGMENT.minConfidence
        : toInt(input.minConfidence, DEFAULT_SEGMENT.minConfidence ?? 0),
    excludeContactedWithinDays: toInt(
      input.excludeContactedWithinDays,
      DEFAULT_SEGMENT.excludeContactedWithinDays,
    ),
    lifetimeCampaignCap: toInt(
      input.lifetimeCampaignCap,
      DEFAULT_SEGMENT.lifetimeCampaignCap,
    ),
  };

  return { segment, errors: validateSegment(segment) };
}

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Descrição legível do segmento, para a tela de revisão e o log de auditoria. */
export function describeSegment(segment: AudienceSegment): string {
  const partes: string[] = [
    `conversas que esfriaram entre ${segment.windowFromDaysAgo} e ${segment.windowToDaysAgo} dias atrás`,
  ];

  if (segment.outcomeReasons?.length) {
    partes.push(`motivo em [${segment.outcomeReasons.join(", ")}]`);
  }
  if (segment.leadStatuses?.length) {
    partes.push(`status em [${segment.leadStatuses.join(", ")}]`);
  }
  if (segment.silenceStages?.length) {
    partes.push(`parou em [${segment.silenceStages.join(", ")}]`);
  }
  if (segment.minConfidence) {
    partes.push(`confiança ≥ ${segment.minConfidence}%`);
  }

  partes.push(`sem contato proativo há ${segment.excludeContactedWithinDays} dias`);
  partes.push(`máx. ${segment.lifetimeCampaignCap} campanhas por contato`);

  return partes.join(" · ");
}
