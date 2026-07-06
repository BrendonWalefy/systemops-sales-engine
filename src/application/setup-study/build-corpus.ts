/**
 * Build-corpus: extrai e anonimiza transcritos de conversas do shadow mode (ADR-002).
 *
 * Regras:
 * - Busca conversas com >= 1 mensagem de clinic_user no período
 *   channelPairedAt → now() (fallback: últimos 21 dias)
 * - Máx. 50 conversas × 30 mensagens cada
 * - Exclui mensagens de author="system"
 * - Anonimização: leads.name → [PACIENTE], sequências 8+ dígitos → [TELEFONE]
 * - Formata com papéis: PACIENTE: / CLINICA: / IA(shadow):
 *
 * Testável sem LLM — retorna AnonymizedTranscript puro.
 */

import { db } from "@/infrastructure/db/client";
import { conversations, messages, leads, organizations } from "@/infrastructure/db/schema";
import { eq, and, gte, desc, inArray } from "drizzle-orm";
import type { AnonymizedTranscript } from "@/domain/entities/setup-study";

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONV = 30;
const FALLBACK_LOOKBACK_DAYS = 21;

/** Anonimiza um texto substituindo padrões sensíveis. */
export function anonymizeText(text: string, leadName: string | null): string {
  let result = text;

  // 1. Substituir nome do lead (case-insensitive, palavra inteira)
  if (leadName && leadName.trim().length > 0) {
    const safeName = leadName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`\\b${safeName}\\b`, "gi"), "[PACIENTE]");
  }

  // 2. Substituir sequências de 8+ dígitos (telefones, CPFs, etc.)
  result = result.replace(/\b\d{8,}\b/g, "[TELEFONE]");

  // 3. Substituir padrões de telefone com separadores: (XX) XXXXX-XXXX, etc.
  result = result.replace(/\(\d{2}\)\s*\d{4,5}[-\s]?\d{4}/g, "[TELEFONE]");

  return result;
}

/** Papel da mensagem no transcript formatado. */
function messageRole(author: string): string {
  if (author === "lead") return "PACIENTE";
  if (author === "clinic_user") return "CLINICA";
  if (author === "agent") return "IA(shadow)";
  return "SISTEMA";
}

/**
 * Constrói o corpus anonimizado de conversas para uma clínica.
 */
export async function buildCorpus(clinicId: string): Promise<AnonymizedTranscript> {
  // 1. Determinar o período
  const [org] = await db
    .select({ channelPairedAt: organizations.channelPairedAt })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  const now = new Date();
  const periodStart = org?.channelPairedAt
    ? new Date(org.channelPairedAt)
    : new Date(now.getTime() - FALLBACK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // 2. Buscar conversas com ao menos uma mensagem de clinic_user/agent
  //    (shadow mode = o agente gera respostas mas não envia)
  const recentConvs = await db
    .select({ id: conversations.id, leadId: conversations.leadId })
    .from(conversations)
    .where(
      and(
        eq(conversations.clinicId, clinicId),
        gte(conversations.lastMessageAt, periodStart),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(MAX_CONVERSATIONS);

  if (recentConvs.length === 0) {
    return {
      clinicId,
      periodStart,
      periodEnd: now,
      conversationCount: 0,
      totalMessages: 0,
      text: "(nenhuma conversa disponível no período)",
    };
  }

  const convIds = recentConvs.map((c) => c.id);
  const leadIds = [...new Set(recentConvs.map((c) => c.leadId).filter(Boolean))] as string[];

  // 3. Buscar nomes dos leads para anonimização
  const leadNames: Record<string, string | null> = {};
  if (leadIds.length > 0) {
    const leadRows = await db
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .where(inArray(leads.id, leadIds));
    for (const l of leadRows) leadNames[l.id] = l.name;
  }

  // 4. Buscar mensagens
  const allMessages = await db
    .select({
      conversationId: messages.conversationId,
      author: messages.author,
      body: messages.body,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, convIds),
      ),
    )
    .orderBy(messages.sentAt);

  // 5. Agrupar por conversa
  const msgsByConv: Record<string, typeof allMessages> = {};
  for (const msg of allMessages) {
    if (!msgsByConv[msg.conversationId]) msgsByConv[msg.conversationId] = [];
    msgsByConv[msg.conversationId].push(msg);
  }

  // 6. Formatar e anonimizar
  const sections: string[] = [];
  let totalMessages = 0;

  for (const conv of recentConvs) {
    const convMsgs = (msgsByConv[conv.id] ?? [])
      .filter((m) => m.author !== "system") // exclui mensagens de sistema
      .slice(0, MAX_MESSAGES_PER_CONV);

    if (convMsgs.length === 0) continue;

    const leadName = conv.leadId ? (leadNames[conv.leadId] ?? null) : null;
    const lines: string[] = [`--- Conversa ---`];

    for (const msg of convMsgs) {
      if (!msg.body) continue;
      const role = messageRole(msg.author);
      const text = anonymizeText(msg.body, leadName);
      lines.push(`${role}: ${text}`);
      totalMessages++;
    }

    sections.push(lines.join("\n"));
  }

  return {
    clinicId,
    periodStart,
    periodEnd: now,
    conversationCount: sections.length,
    totalMessages,
    text: sections.join("\n\n"),
  };
}
