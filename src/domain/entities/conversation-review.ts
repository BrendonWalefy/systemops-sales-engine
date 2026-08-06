/**
 * Entidades de domínio da Revisão de Conversas pelo Cliente
 * A feature está catalogada em docs/features.md.
 * Tipos puros — sem dependências de infra ou framework.
 *
 * O cliente vê "Revisão de conversas" e os rótulos "Paciente" /
 * "Assistente IA" / "Equipe da clínica" — nunca "shadow" ou "simulated"
 * (Apêndice I do plano).
 */

/**
 * Papel de uma mensagem dentro de um trecho.
 * `clinica` = resposta humana real capturada durante o shadow mode.
 */
export type ExcerptRole = "lead" | "ia" | "clinica";

/** Uma mensagem congelada dentro de um trecho. */
export interface ExcerptMessage {
  role: ExcerptRole;
  /** Corpo da mensagem — JÁ anonimizado no snapshot (nunca dado bruto). */
  body: string;
  /** ISO timestamp do envio original. */
  sentAt: string;
  /** deliveryFormat === "audio" na origem → marcador 🎤 na UI. */
  wasAudio?: boolean;
}

/** Avaliação possível de um trecho pelo cliente. */
export type ExcerptFeedbackRating = "good" | "adjust";

/** Feedback opcional do cliente sobre um trecho (página pública, PR 2). */
export interface ExcerptFeedback {
  /** "good" = 👍 Ficou bom | "adjust" = ✏️ Eu ajustaria. */
  rating: ExcerptFeedbackRating;
  /** "O que você mudaria?" — opcional, máx. 1000 chars. */
  comment?: string;
  /** "Como você responderia?" — opcional, máx. 1000 chars. */
  suggestedReply?: string;
  /** ISO timestamp de quando o trecho foi respondido. */
  answeredAt: string;
}

/**
 * Um trecho de conversa curado pelo owner. Snapshot congelado: as mensagens
 * são copiadas (anonimizadas) para o jsonb no momento da curadoria — a página
 * pública nunca consulta `messages` (Apêndice G do plano).
 */
export interface ConversationExcerpt {
  /** uuid gerado na curadoria. */
  id: string;
  /** Rastreabilidade interna; NUNCA vai à página pública. */
  sourceConversationId: string;
  /** 1 linha do owner (máx. 140 chars): "Lead perguntou preço de lente". */
  context?: string;
  /** Snapshot congelado, ordenado por sentAt. */
  messages: ExcerptMessage[];
  /** Resposta do cliente na página pública (ausente até ele responder). */
  feedback?: ExcerptFeedback;
}

/**
 * Forma de um trecho segura para a página pública: sem `sourceConversationId`.
 * A Server Component→Client Component boundary do Next serializa as props no
 * payload RSC enviado ao browser — mesmo que a UI não renderize o campo, ele
 * chegaria ao cliente não autenticado se `ConversationExcerpt` fosse passado
 * direto. Use este tipo em qualquer superfície pública (page → client
 * component) e monte-o com `toPublicExcerpt` abaixo.
 */
export type PublicConversationExcerpt = Omit<ConversationExcerpt, "sourceConversationId">;

/** Remove o campo de rastreabilidade interna antes de expor um trecho publicamente. */
export function toPublicExcerpt(excerpt: ConversationExcerpt): PublicConversationExcerpt {
  const publicExcerpt: Partial<ConversationExcerpt> = { ...excerpt };
  delete publicExcerpt.sourceConversationId;
  return publicExcerpt as PublicConversationExcerpt;
}

/** Status possíveis de uma rodada de revisão (enum próprio — sem "applied"). */
export type ConversationReviewStatus =
  | "draft"
  | "sent"
  | "answered"
  | "expired";

/** Entidade de domínio completa de uma rodada de revisão de conversas. */
export interface ConversationReview {
  id: string;
  organizationId: string;
  status: ConversationReviewStatus;
  /** Ex.: "Rodada 1 — semana de 14/07". */
  title: string;
  excerpts: ConversationExcerpt[];
  /** Comentário geral do cliente na conclusão (opcional). */
  overallComment: string | null;
  accessTokenHash: string | null;
  sentAt: Date | null;
  answeredAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Limites (Apêndice H do plano — decisões fechadas) ──────────────────────

/** Mínimo de trechos por rodada para poder enviar ao cliente. */
export const MIN_EXCERPTS_PER_REVIEW = 3;
/** Máximo de trechos por rodada. */
export const MAX_EXCERPTS_PER_REVIEW = 10;
/** Mínimo de mensagens por trecho. */
export const MIN_MESSAGES_PER_EXCERPT = 3;
/** Máximo de mensagens por trecho. */
export const MAX_MESSAGES_PER_EXCERPT = 15;
/** Máximo de caracteres da linha de contexto do owner. */
export const MAX_EXCERPT_CONTEXT_CHARS = 140;
/** Máximo de caracteres do título da rodada. */
export const MAX_REVIEW_TITLE_CHARS = 140;
/** Máximo de caracteres dos textos de feedback (mesmo limite da validação). */
export const MAX_FEEDBACK_TEXT_CHARS = 1000;
