// Cron diário (7h UTC) — analisa conversas recentes por clínica e gera insights em duas categorias:
// - operational: lacunas operacionais (tratamento não cadastrado, preço ausente, etc.)
// - ai_quality: onde o assistente de IA poderia ter respondido melhor

import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import {
  organizations,
  clinicOperationalInsights,
  conversations,
  messages,
  treatments,
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
  category: "operational" | "ai_quality";
  title: string;
  description: string;
  affectedCount: number;
  convIds: string[];
  actionData: Record<string, unknown>;
};

async function callLLM(prompt: string): Promise<string> {
  if (INSIGHT_MODEL.startsWith("claude-")) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: INSIGHT_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0].type === "text" ? res.content[0].text : "";
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: INSIGHT_MODEL,
    max_tokens: 1500,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0]?.message?.content ?? "";
}

type RawInsight = {
  type?: unknown;
  title?: unknown;
  description?: unknown;
  convIndices?: unknown;
  action_data?: unknown;
};

function normalizeInsights(
  arr: unknown[],
  category: "operational" | "ai_quality",
  convIdMap: string[],
): InsightDraft[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (i): i is RawInsight =>
        i !== null &&
        typeof i === "object" &&
        typeof (i as RawInsight).title === "string" &&
        typeof (i as RawInsight).description === "string",
    )
    .map((i) => {
      const rawIndices = Array.isArray(i.convIndices) ? (i.convIndices as unknown[]) : [];
      const convIds = rawIndices
        .filter((idx): idx is number => typeof idx === "number" && idx >= 1 && idx <= convIdMap.length)
        .map((idx) => convIdMap[idx - 1])
        .filter((id): id is string => typeof id === "string");

      const actionData =
        i.action_data !== null && typeof i.action_data === "object"
          ? (i.action_data as Record<string, unknown>)
          : {};

      return {
        type: typeof i.type === "string" ? i.type : "other",
        category,
        title: String(i.title).slice(0, 80),
        description: String(i.description).slice(0, 200),
        affectedCount: convIds.length || 1,
        convIds,
        actionData,
      };
    })
    .slice(0, 3);
}

function parseInsights(raw: string, convIdMap: string[]): InsightDraft[] {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const json = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(raw);
    return [
      ...normalizeInsights(json.operational ?? [], "operational", convIdMap),
      ...normalizeInsights(json.ai_quality ?? [], "ai_quality", convIdMap),
    ].slice(0, 6);
  } catch {
    return [];
  }
}

type TreatmentRow = { name: string; priceCents: number | null; minPriceCents: number | null; maxPriceCents: number | null };

function formatTreatmentCatalog(catalog: TreatmentRow[]): string {
  if (catalog.length === 0) return "Nenhum tratamento cadastrado.";
  return catalog
    .map((t) => {
      const price = t.priceCents
        ? `R$ ${(t.priceCents / 100).toFixed(0)}`
        : t.minPriceCents && t.maxPriceCents
          ? `R$ ${(t.minPriceCents / 100).toFixed(0)}–${(t.maxPriceCents / 100).toFixed(0)}`
          : "sem preço cadastrado";
      return `- ${t.name} (${price})`;
    })
    .join("\n");
}

async function analyzeClinic(clinicId: string, clinicName: string): Promise<InsightDraft[]> {
  const since = new Date();
  since.setHours(since.getHours() - 48);

  const [recentConvs, clinicTreatments] = await Promise.all([
    db
      .select({ id: conversations.id, leadId: conversations.leadId })
      .from(conversations)
      .where(and(eq(conversations.clinicId, clinicId), gte(conversations.lastMessageAt, since)))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(MAX_CONVERSATIONS),
    db
      .select({
        name: treatments.name,
        priceCents: treatments.priceCents,
        minPriceCents: treatments.minPriceCents,
        maxPriceCents: treatments.maxPriceCents,
      })
      .from(treatments)
      .where(eq(treatments.clinicId, clinicId)),
  ]);

  if (recentConvs.length < 3) return [];

  const convIdMap = recentConvs.map((c) => c.id);

  const msgRows = await db
    .select({
      conversationId: messages.conversationId,
      author: messages.author,
      body: messages.body,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(inArray(messages.conversationId, convIdMap))
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
        const role = m.author === "lead" ? "Lead" : "IA";
        return `  ${role}: ${(m.body ?? "").slice(0, 200)}`;
      });
      return `Conversa ${idx + 1}:\n${lines.join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const catalogText = formatTreatmentCatalog(clinicTreatments);

  const prompt = `Você é um analista especializado em clínicas estéticas.

Clínica: "${clinicName}"

CATÁLOGO DE TRATAMENTOS CADASTRADOS:
${catalogText}

CONVERSAS RECENTES (últimas 48h) entre assistente de IA e leads:
[CONVERSAS]
${conversationsText}
[/CONVERSAS]

Analise as conversas e identifique insights em DUAS categorias:

CATEGORIA 1 — OPERACIONAL (problemas que o gestor precisa resolver):
- Tratamentos/procedimentos perguntados pelo lead que NÃO existem no catálogo acima
- Tratamentos no catálogo sem preço, onde o lead perguntou sobre valor
- Serviços ou tópicos que a IA não conseguiu responder por falta de informação cadastrada
- Padrões de pergunta recorrente que indicam algo importante faltando no sistema

CATEGORIA 2 — QUALIDADE DA IA (onde o assistente poderia ter se saído melhor):
- Respostas confusas, genéricas ou que não endereçaram a dúvida do lead
- Oportunidades perdidas de conduzir para agendamento quando o lead estava pronto
- Respostas robóticas ou pouco naturais que podem ter esfriado o lead
- Hesitação do lead logo após uma resposta da IA (sinal de que a resposta não foi boa)
- Objeções de preço ou condição que a IA não soube contornar com clareza

IMPORTANTE:
- Para "tratamento não cadastrado", verifique se o tema (mesmo implícito) corresponde a algo fora do catálogo. Exemplo: lead pergunta sobre "deixar os dentes mais brancos" → clareamento dental não cadastrado.
- Em convIndices coloque os NÚMEROS das conversas onde o padrão ocorreu (ex: [1, 3, 5])
- Para action_data: inclua "treatmentName" para insights operacionais sobre tratamentos; inclua "suggestedInstruction" para insights de qualidade da IA — uma instrução concreta e pronta para ser adicionada ao playbook do assistente.

Responda APENAS com JSON válido (máx 3 insights por categoria, só inclua os relevantes):
{
  "operational": [
    {
      "type": "missing_treatment" | "price_not_set" | "service_gap" | "info_gap" | "other",
      "title": "Título curto e direto (máx 60 chars)",
      "description": "Padrão identificado com contexto específico (máx 150 chars)",
      "convIndices": [lista de números das conversas onde ocorreu, ex: [1, 3]],
      "action_data": {
        "treatmentName": "nome do tratamento mencionado ou faltante"
      }
    }
  ],
  "ai_quality": [
    {
      "type": "unclear_response" | "missed_opportunity" | "unnatural_reply" | "price_objection_unresolved" | "hesitation_after_reply" | "other",
      "title": "Título curto e direto (máx 60 chars)",
      "description": "Padrão identificado com contexto específico (máx 150 chars)",
      "convIndices": [lista de números das conversas onde ocorreu, ex: [2, 4]],
      "action_data": {
        "suggestedInstruction": "instrução concreta e pronta para adicionar ao playbook do assistente"
      }
    }
  ]
}

Se não houver insights relevantes em uma categoria, retorne array vazio para ela.`;

  const raw = await callLLM(prompt);
  return parseInsights(raw, convIdMap);
}

export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuthorization(req);
  if (unauthorized) return unauthorized;

  const activeClinics = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.operationalStatus, "active"));

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + INSIGHT_TTL_DAYS);

  const results: Array<{ clinicId: string; insights: number; status: "ok" | "skip" | "error" }> = [];

  for (const clinic of activeClinics) {
    try {
      const drafts = await analyzeClinic(clinic.id, clinic.name);

      await db
        .delete(clinicOperationalInsights)
        .where(eq(clinicOperationalInsights.clinicId, clinic.id));

      if (drafts.length > 0) {
        await db.insert(clinicOperationalInsights).values(
          drafts.map((d) => ({
            clinicId: clinic.id,
            type: d.type,
            category: d.category,
            title: d.title,
            description: d.description,
            affectedCount: d.affectedCount,
            convIds: d.convIds.length > 0 ? d.convIds : null,
            actionData: Object.keys(d.actionData).length > 0 ? d.actionData : null,
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
