// Cron diário (7h UTC) — analisa conversas recentes por clínica e gera insights operacionais.
// Usa LLM para identificar padrões: objeção de preço, hesitação, resposta confusa, etc.
// Resultados ficam disponíveis no card "Pontos de Melhoria" na home.

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  clinics,
  clinicOperationalInsights,
  conversations,
  messages,
} from "@/infrastructure/db/schema";
import { requireCronAuthorization } from "@/app/api/cron/_auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INSIGHT_MODEL = process.env.ADVISOR_MODEL ?? "gpt-4o-mini";
const MAX_CONVERSATIONS = 15;
const MAX_MESSAGES_PER_CONV = 12;
const INSIGHT_TTL_DAYS = 3;

type InsightDraft = {
  type: string;
  title: string;
  description: string;
  affectedCount: number;
};

async function callLLM(prompt: string): Promise<string> {
  if (INSIGHT_MODEL.startsWith("claude-")) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: INSIGHT_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0].type === "text" ? res.content[0].text : "";
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: INSIGHT_MODEL,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0]?.message?.content ?? "";
}

function parseInsights(raw: string): InsightDraft[] {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const json = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    const arr = Array.isArray(json.insights) ? json.insights : [];
    return arr
      .filter(
        (i: unknown) =>
          i !== null &&
          typeof i === "object" &&
          typeof (i as Record<string, unknown>).title === "string" &&
          typeof (i as Record<string, unknown>).description === "string",
      )
      .map((i: Record<string, unknown>) => ({
        type: typeof i.type === "string" ? i.type : "other",
        title: String(i.title).slice(0, 80),
        description: String(i.description).slice(0, 200),
        affectedCount: typeof i.affectedCount === "number" ? i.affectedCount : 1,
      }))
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function analyzeClinic(
  clinicId: string,
  clinicName: string,
): Promise<InsightDraft[]> {
  const since = new Date();
  since.setHours(since.getHours() - 48);

  const recentConvs = await db
    .select({ id: conversations.id, leadId: conversations.leadId })
    .from(conversations)
    .where(
      and(
        eq(conversations.clinicId, clinicId),
        gte(conversations.lastMessageAt, since),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(MAX_CONVERSATIONS);

  if (recentConvs.length < 3) return [];

  const convIds = recentConvs.map((c) => c.id);
  const msgRows = await db
    .select({
      conversationId: messages.conversationId,
      author: messages.author,
      body: messages.body,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, convIds))
    .orderBy(messages.conversationId, messages.sentAt);

  const byConv = new Map<string, typeof msgRows>();
  for (const msg of msgRows) {
    const list = byConv.get(msg.conversationId) ?? [];
    if (list.length < MAX_MESSAGES_PER_CONV) list.push(msg);
    byConv.set(msg.conversationId, list);
  }

  const conversationsText = recentConvs
    .map((conv, idx) => {
      const msgs = byConv.get(conv.id) ?? [];
      if (msgs.length === 0) return null;
      const lines = msgs.map((m) => {
        const role = m.author === "lead" ? "Lead" : "AI";
        return `  ${role}: ${(m.body ?? "").slice(0, 200)}`;
      });
      return `Conversa ${idx + 1}:\n${lines.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const prompt = `Você é um analista de conversas de clínicas estéticas.

Analise as seguintes ${recentConvs.length} conversas recentes (últimas 48h) da clínica "${clinicName}" entre o assistente AI e leads:

[CONVERSAS]
${conversationsText}
[/CONVERSAS]

Identifique de 1 a 4 padrões operacionais que o gestor deveria saber. Foque em:
- Objeções de preço/parcelamento que ficaram sem resolução clara
- Leads com interesse que hesitaram e não agendaram
- Respostas do AI que pareceram confusas, incompletas ou inadequadas
- Serviços/tratamentos perguntados que o AI não soube informar
- Qualquer fricção recorrente que esteja impedindo agendamentos

Responda APENAS com JSON válido:
{
  "insights": [
    {
      "type": "price_objection" | "hesitation_drop" | "unclear_response" | "service_gap" | "scheduling_friction" | "other",
      "title": "Título curto e direto (máx 60 chars)",
      "description": "Padrão identificado com contexto específico (máx 150 chars)",
      "affectedCount": número de conversas onde isso ocorreu
    }
  ]
}

Se não houver padrões relevantes, retorne {"insights": []}.`;

  const raw = await callLLM(prompt);
  return parseInsights(raw);
}

export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuthorization(req);
  if (unauthorized) return unauthorized;

  const activeClinics = await db
    .select({ id: clinics.id, name: clinics.name })
    .from(clinics)
    .where(eq(clinics.operationalStatus, "active"));

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + INSIGHT_TTL_DAYS);

  const results: Array<{ clinicId: string; insights: number; status: "ok" | "skip" | "error" }> = [];

  for (const clinic of activeClinics) {
    try {
      const drafts = await analyzeClinic(clinic.id, clinic.name);

      // Remove insights anteriores não descartados antes de inserir novos
      await db
        .delete(clinicOperationalInsights)
        .where(eq(clinicOperationalInsights.clinicId, clinic.id));

      if (drafts.length > 0) {
        await db.insert(clinicOperationalInsights).values(
          drafts.map((d) => ({
            clinicId: clinic.id,
            type: d.type,
            title: d.title,
            description: d.description,
            affectedCount: d.affectedCount,
            expiresAt,
          })),
        );
      }

      results.push({ clinicId: clinic.id, insights: drafts.length, status: drafts.length > 0 ? "ok" : "skip" });
      console.log(`[conversation-insights] clinicId=${clinic.id} insights=${drafts.length}`);
    } catch (err) {
      console.error(`[conversation-insights] ERRO clinicId=${clinic.id}`, err);
      results.push({ clinicId: clinic.id, insights: 0, status: "error" });
    }
  }

  return NextResponse.json({ processed: activeClinics.length, results });
}
