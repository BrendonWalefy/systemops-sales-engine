/**
 * Entidades de domínio para o estudo de setup (ADR-002).
 * Tipos puros — sem dependências de infra ou framework.
 */

/** Categorias de mudanças que um finding pode propor. */
export type SetupFindingCategory =
  | "price"
  | "communication"
  | "qualification"
  | "policy"
  | "tone"
  | "other";

/**
 * Allowlist de targets válidos para propostas de mudança.
 * Qualquer target fora desta lista resulta em proposedChange = null.
 * Formato: campo estático ou campo de tratamento prefixado com UUID.
 */
export const VALID_TARGETS = [
  // Campos de tratamento — prefixo dinâmico
  "treatment:.priceCents",
  "treatment:.priceQuotableInChat",
  "treatment:.aliases",
  "treatment:.requiresEvaluationFirst",
  // Campos do playbook
  "playbook.objections[]",
  "playbook.toneOfVoice",
  "playbook.commercialPolicy",
  "playbook.notes",
] as const;

/** Verifica se um target de finding é válido (allowlist). */
export function isValidFindingTarget(target: string): boolean {
  // Campos estáticos exatos
  const staticTargets = VALID_TARGETS.filter((t) => !t.startsWith("treatment:"));
  if (staticTargets.includes(target as (typeof staticTargets)[number])) return true;

  // Campos de tratamento: treatment:<uuid>.<campo>
  const treatmentPattern = /^treatment:[0-9a-f-]{36}\.(priceCents|priceQuotableInChat|aliases|requiresEvaluationFirst)$/;
  return treatmentPattern.test(target);
}

/**
 * Uma descoberta individual do estudo de setup.
 * Representa uma discrepância ou oportunidade de melhoria identificada pelo LLM.
 */
export interface SetupFinding {
  /** Identificador único dentro do estudo (gerado no build). */
  id: string;
  /** Categoria semântica do finding. */
  category: SetupFindingCategory;
  /** Afirmação observada nas conversas (máx. 280 chars). Editável pelo owner. */
  claim: string;
  /** Evidência textual extraída do transcript (máx. 400 chars). */
  evidence: string;
  /** Severidade estimada pelo LLM: 1 (baixa) a 3 (alta). */
  severity: 1 | 2 | 3;
  /**
   * Proposta de mudança em banco (campo → novo valor).
   * null quando target está fora da allowlist ou LLM não conseguiu inferir.
   */
  proposedChange: SetupFindingProposedChange | null;
  /**
   * Resposta do responsável na página pública de validação (Fase 2).
   * Ausente enquanto o finding não foi respondido.
   */
  answer?: SetupFindingAnswer;
  /**
   * Trilha de auditoria da aplicação (Fase 3). Ausente enquanto o owner não
   * aplicou o finding à config. Registrado no próprio jsonb do estudo.
   */
  applied?: SetupFindingApplied;
}

/** Registro de aplicação de um finding à config da clínica (ADR-002 Fase 3). */
export interface SetupFindingApplied {
  /** ISO timestamp de quando o owner aplicou. */
  at: string;
  /** Resumo legível do que foi escrito (ex: "Preço da Avaliação → R$ 150,00"). */
  summary: string;
}

/** Proposta concreta de mudança em um campo do banco. */
export interface SetupFindingProposedChange {
  /** Campo alvo no formato da allowlist (ex: "treatment:<uuid>.priceCents"). */
  target: string;
  /** Novo valor proposto (sempre string — parse/cast feito na aplicação). */
  newValue: string;
  /** Valor atual no banco no momento da extração. */
  currentValue: string;
}

/**
 * Resposta do responsável da clínica a um finding, gravada na página pública
 * de validação (ADR-002 Fase 2). Ausente enquanto o finding não foi respondido.
 */
export interface SetupFindingAnswer {
  /** "confirmed" = o claim está correto; "corrected" = o cliente reescreveu. */
  status: "confirmed" | "corrected";
  /** Texto livre do responsável quando status = "corrected". */
  correction?: string;
  /** ISO timestamp de quando o item foi respondido. */
  answeredAt: string;
}

/** Status possíveis de um estudo de setup. */
export type SetupStudyStatus =
  | "draft"
  | "sent"
  | "answered"
  | "applied"
  | "expired";

/** Entidade de domínio completa de um estudo de setup. */
export interface SetupStudy {
  id: string;
  organizationId: string;
  status: SetupStudyStatus;
  findings: SetupFinding[];
  accessTokenHash: string | null;
  sentAt: Date | null;
  answeredAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Transcript anonimizado pronto para ser enviado ao LLM. */
export interface AnonymizedTranscript {
  clinicId: string;
  periodStart: Date;
  periodEnd: Date;
  conversationCount: number;
  totalMessages: number;
  text: string;
}
