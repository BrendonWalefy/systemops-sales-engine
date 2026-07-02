import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, messages, organizations } from "@/infrastructure/db/schema";
import { e2eGuard } from "../_guard";

// GET /api/e2e/production-conversations?clinicId=...&limit=5
//
// Ferramenta de melhoria contínua (OmniQA): expõe mensagens reais de leads de uma
// clínica de produção para replay contra uma clínica de teste isolada. Só retorna
// texto de mensagens do autor "lead" (nunca do operador/IA) e só de clínicas
// isTest=false — é leitura, nunca escreve nada na clínica de origem.
export async function GET(req: NextRequest) {
  const guard = e2eGuard(req);
  if (guard) return guard;

  const clinicId = req.nextUrl.searchParams.get("clinicId");
  if (!clinicId) {
    return NextResponse.json({ error: "clinicId is required" }, { status: 400 });
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "5") || 5, 20);
  const maxMessagesPerConversation = Math.min(
    Number(req.nextUrl.searchParams.get("messagesPerConversation") ?? "3") || 3,
    10,
  );

  const [org] = await db
    .select({ id: organizations.id, isTest: organizations.isTest })
    .from(organizations)
    .where(eq(organizations.id, clinicId))
    .limit(1);

  if (!org) {
    return NextResponse.json({ error: "clinic not found" }, { status: 404 });
  }
  if (org.isTest) {
    return NextResponse.json({ error: "clinicId must be a real (isTest=false) clinic" }, { status: 400 });
  }

  // Conversas de venda, com pelo menos uma resposta da IA (conversa completa, não
  // abandonada logo na primeira mensagem), mais recentes primeiro.
  const candidateConversations = await db
    .select({ id: conversations.id, leadId: conversations.leadId, lastMessageAt: conversations.lastMessageAt })
    .from(conversations)
    .where(
      and(
        eq(conversations.clinicId, clinicId),
        eq(conversations.category, "sales"),
        isNotNull(conversations.lastMessageAt),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit * 3); // margem: nem toda conversa candidata terá mensagem de agente

  const conversationIds = candidateConversations.map((c) => c.id);
  if (conversationIds.length === 0) {
    return NextResponse.json({ conversations: [] });
  }

  const allMessages = await db
    .select({
      conversationId: messages.conversationId,
      author: messages.author,
      body: messages.body,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, conversationIds))
    .orderBy(messages.sentAt);

  const byConversation = new Map<string, typeof allMessages>();
  for (const m of allMessages) {
    const list = byConversation.get(m.conversationId) ?? [];
    list.push(m);
    byConversation.set(m.conversationId, list);
  }

  const leadIds = [...new Set(candidateConversations.map((c) => c.leadId))];
  const leadRows = leadIds.length > 0
    ? await db.select({ id: leads.id, treatmentInterest: leads.treatmentInterest }).from(leads).where(inArray(leads.id, leadIds))
    : [];
  const leadTreatmentById = new Map(leadRows.map((l) => [l.id, l.treatmentInterest]));

  const result = candidateConversations
    .map((c) => {
      const msgs = byConversation.get(c.id) ?? [];
      const hasAgentReply = msgs.some((m) => m.author === "agent");
      const leadMessages = msgs
        .filter((m) => m.author === "lead" && m.body && m.body.trim().length > 0)
        .slice(0, maxMessagesPerConversation)
        .map((m) => m.body);

      return {
        conversationId: c.id,
        leadId: c.leadId,
        treatmentInterest: leadTreatmentById.get(c.leadId) ?? null,
        hasAgentReply,
        leadMessages,
      };
    })
    .filter((c) => c.hasAgentReply && c.leadMessages.length > 0)
    .slice(0, limit);

  return NextResponse.json({ conversations: result });
}
