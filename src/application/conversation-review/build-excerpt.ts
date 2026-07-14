/**
 * Build-excerpt: monta um trecho congelado de conversa para a Revisão de
 * Conversas pelo Cliente (docs/product/revisao-conversas-plano.md, seção 7).
 *
 * Regras:
 * - Guarda de tenant: a conversa precisa pertencer à clínica (WHERE escopado).
 * - Mapeamento de papéis: lead→lead, agent→ia, clinic_user→clinica,
 *   system→descartada.
 * - Anonimização via `anonymizeText()` (reuso direto do setup study — nome do
 *   lead → [PACIENTE], 8+ dígitos → [TELEFONE]).
 * - Mídia vira placeholder (Apêndice C): [foto] 📷 / [vídeo] 🎬 / [áudio] 🎤 /
 *   [documento] 📄 + body se houver. `mediaUrl` NUNCA entra no snapshot.
 * - deliveryFormat=audio com corpo de texto → texto com marcador `wasAudio`.
 * - Snapshot ordenado por sentAt; limites do Apêndice H (3–15 mensagens).
 *
 * O snapshot é congelado: a página pública nunca consulta `messages`, então
 * editar/apagar a conversa de origem não afeta uma rodada já enviada.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/infrastructure/db/client";
import { conversations, messages, leads } from "@/infrastructure/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { anonymizeText } from "@/application/setup-study/build-corpus";
import {
  MIN_MESSAGES_PER_EXCERPT,
  MAX_MESSAGES_PER_EXCERPT,
} from "@/domain/entities/conversation-review";
import type {
  ConversationExcerpt,
  ExcerptMessage,
  ExcerptRole,
} from "@/domain/entities/conversation-review";

/** Placeholders de mídia (Apêndice C do plano — decisão fechada). */
const MEDIA_PLACEHOLDERS: Record<string, string> = {
  image: "[foto] 📷",
  video: "[vídeo] 🎬",
  audio: "[áudio] 🎤",
  document: "[documento] 📄",
};

/** Linha crua de mensagem, como sai do banco (subset usado pelo builder). */
export interface ExcerptSourceMessage {
  id: string;
  author: string;
  body: string;
  mediaType: string | null;
  deliveryFormat: string | null;
  sentAt: Date;
}

/** Mapeia o author do banco para o papel client-facing. null = descartar. */
function mapRole(author: string): ExcerptRole | null {
  if (author === "lead") return "lead";
  if (author === "agent") return "ia";
  if (author === "clinic_user") return "clinica";
  return null; // system e desconhecidos são descartados
}

/**
 * Monta o snapshot congelado a partir das linhas cruas. Função pura e
 * testável — a guarda de tenant e o carregamento ficam em `buildExcerpt`.
 *
 * Aplica: filtro pelos ids solicitados, descarte de `system`, mapeamento de
 * papéis, anonimização, placeholder de mídia, marcador de áudio, ordenação
 * por sentAt e validação dos limites do Apêndice H.
 */
export function assembleExcerpt(input: {
  conversationId: string;
  requestedMessageIds: string[];
  rows: ExcerptSourceMessage[];
  leadName: string | null;
}): ConversationExcerpt {
  const requested = new Set(input.requestedMessageIds);

  const excerptMessages: ExcerptMessage[] = input.rows
    .filter((row) => requested.has(row.id))
    .map((row) => ({ row, role: mapRole(row.author) }))
    .filter((item): item is { row: ExcerptSourceMessage; role: ExcerptRole } =>
      item.role !== null,
    )
    .map(({ row, role }) => {
      const anonymized = anonymizeText(row.body, input.leadName).trim();

      // Mídia vira placeholder + corpo (se houver). mediaUrl nunca entra.
      const placeholder = row.mediaType
        ? MEDIA_PLACEHOLDERS[row.mediaType]
        : undefined;
      const body = placeholder
        ? anonymized
          ? `${placeholder} ${anonymized}`
          : placeholder
        : anonymized;

      const wasAudio = row.deliveryFormat === "audio";
      return {
        role,
        body,
        sentAt: row.sentAt.toISOString(),
        ...(wasAudio ? { wasAudio: true } : {}),
      };
    })
    // Defensivo: sem corpo e sem mídia não há bolha para renderizar.
    .filter((m) => m.body.length > 0)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));

  if (excerptMessages.length < MIN_MESSAGES_PER_EXCERPT) {
    throw new Error(
      `Selecione ao menos ${MIN_MESSAGES_PER_EXCERPT} mensagens de conversa (paciente, IA ou equipe).`,
    );
  }
  if (excerptMessages.length > MAX_MESSAGES_PER_EXCERPT) {
    throw new Error(
      `Um trecho pode ter no máximo ${MAX_MESSAGES_PER_EXCERPT} mensagens.`,
    );
  }

  return {
    id: randomUUID(),
    sourceConversationId: input.conversationId,
    messages: excerptMessages,
  };
}

/**
 * Carrega a conversa (com guarda de tenant no WHERE), o nome do lead e as
 * mensagens solicitadas, e devolve o `ConversationExcerpt` congelado.
 *
 * MULTI-TENANT: a conversa é resolvida por `(id, organizationId)` — pedir um
 * `conversationId` de outra clínica resulta em erro, nunca em vazamento.
 */
export async function buildExcerpt(
  clinicId: string,
  conversationId: string,
  messageIds: string[],
): Promise<ConversationExcerpt> {
  const [conv] = await db
    .select({ id: conversations.id, leadName: leads.name })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.clinicId, clinicId),
      ),
    )
    .limit(1);

  if (!conv) {
    throw new Error("Conversa não encontrada nesta clínica.");
  }

  if (messageIds.length === 0) {
    throw new Error(
      `Selecione ao menos ${MIN_MESSAGES_PER_EXCERPT} mensagens de conversa (paciente, IA ou equipe).`,
    );
  }

  const rows = await db
    .select({
      id: messages.id,
      author: messages.author,
      body: messages.body,
      mediaType: messages.mediaType,
      deliveryFormat: messages.deliveryFormat,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        inArray(messages.id, messageIds),
      ),
    )
    .orderBy(messages.sentAt);

  return assembleExcerpt({
    conversationId,
    requestedMessageIds: messageIds,
    rows,
    leadName: conv.leadName,
  });
}
