import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "@/infrastructure/db/client";
import { conversations, leads, messages } from "@/infrastructure/db/schema";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<NextResponse> {
  const sessionClinicId = await getSessionClinicId();
  if (!sessionClinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { conversationId } = await params;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clinicId, sessionClinicId)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [lead] = await db
    .select({ name: leads.name, treatmentInterest: leads.treatmentInterest, temperature: leads.temperature })
    .from(leads)
    .where(eq(leads.id, conv.leadId))
    .limit(1);

  const allMsgs = await db
    .select({ author: messages.author, body: messages.body })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sentAt));

  const recent = allMsgs.slice(-12);
  const history = recent.map((m) => ({
    role: m.author === "lead" ? ("user" as const) : ("assistant" as const),
    content: m.body || "(mídia)",
  }));

  const leadName = lead?.name ?? "cliente";
  const interest = lead?.treatmentInterest ?? "tratamento odontológico";

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Você é um assistente de recepção odontológica sugerindo uma resposta para o operador humano enviar ao lead "${leadName}".
Interesse do lead: ${interest}.
Gere UMA resposta curta (máx 2 frases), empática, comercialmente inteligente, no tom de quem quer ajudar e fechar o atendimento.
Não use asteriscos, markdown, emojis excessivos ou linguagem robótica.
Retorne apenas o texto da resposta, sem prefixos ou explicações.`,
      },
      ...history,
    ],
    max_tokens: 120,
    temperature: 0.65,
  });

  const suggestion = completion.choices[0]?.message?.content?.trim() ?? "";
  return NextResponse.json({ suggestion });
}
