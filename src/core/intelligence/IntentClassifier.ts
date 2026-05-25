// LLM Estágio 1: Entende intenção do lead — rápido, barato, retorno estruturado.
// NÃO compõe resposta. NÃO decide o que fazer. Apenas classifica.

import OpenAI from "openai";
import type { Message } from "@/domain/entities/conversation";

const MODEL = "gpt-4o-mini";

export type SlotPreference = {
  preferredDate?: string;          // "amanhã", "quinta-feira", "26/06"
  preferredPeriod?: "morning" | "afternoon" | "evening";
  preferredTime?: string;          // "10h", "depois das 14h"
  slotChoice?: number;             // 1, 2 ou 3 — quando confirma slot específico
  appointmentType?: string;        // "avaliação", "retorno", "implante"
};

export type IntentType =
  | "book_appointment"        // quer agendar, não especificou dia/hora ainda
  | "check_availability"      // pergunta quais horários disponíveis
  | "confirm_slot"            // escolheu um dos slots oferecidos
  | "reject_slots"            // não quer nenhum dos slots oferecidos
  | "cancel_appointment"      // quer cancelar agendamento existente
  | "reschedule_appointment"  // quer remarcar agendamento existente
  | "list_appointments"       // quer ver seus agendamentos
  | "price_inquiry"           // perguntou sobre preço/valor
  | "clinical_urgency"        // menciona dor, urgência, sangramento
  | "general_question"        // pergunta geral sobre a clínica
  | "greeting"                // apenas cumprimentou
  | "unclear";                // não foi possível entender

export type IntentClassification = {
  intent: IntentType;
  slotPreference: SlotPreference;
  confidence: number;                 // 0-1
  shouldAskClarification: boolean;
  clarificationQuestion?: string;     // pergunta a fazer ao lead se incerto
};

const SYSTEM_PROMPT = `Você é um classificador de intenções para uma recepcionista virtual de clínica odontológica.

Sua única função é analisar a última mensagem do lead e retornar um JSON estruturado com a intenção detectada.

REGRAS:
- Analise SEMPRE no contexto da conversa anterior
- Se o lead mandou "1", "2" ou "3" e há contexto de oferta de horários → intent = "confirm_slot" com slotChoice = número
- Se o lead disse "pode ser", "esse", "quero esse", "tá bom" após oferta → intent = "confirm_slot"
- "nenhum desses", "outro horário", "não tenho disponibilidade" → intent = "reject_slots"
- "quanto custa", "qual o valor", "tem plano" → intent = "price_inquiry"
- "dor", "urgência", "sangramento", "emergência", "urgente" → intent = "clinical_urgency"
- Se a mensagem é só "oi", "olá", "bom dia" sem contexto adicional → intent = "greeting"
- Se genuinamente não entendeu → intent = "unclear" com clarificationQuestion preenchida

Para preferências de horário:
- Extraia "amanhã", "sexta", "próxima semana", datas explícitas → preferredDate (verbatim do texto)
- "de manhã", "manhã", "antes do meio-dia" → period = "morning"
- "à tarde", "tarde", "depois do almoço" → period = "afternoon"
- "à noite", "noite" → period = "evening"
- Horas específicas como "às 10h", "10:00", "dez horas" → preferredTime (verbatim)

Retorne APENAS JSON válido, sem markdown, sem explicação.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "book_appointment",
        "check_availability",
        "confirm_slot",
        "reject_slots",
        "cancel_appointment",
        "reschedule_appointment",
        "list_appointments",
        "price_inquiry",
        "clinical_urgency",
        "general_question",
        "greeting",
        "unclear",
      ],
    },
    slotPreference: {
      type: "object",
      properties: {
        preferredDate: { type: "string" },
        preferredPeriod: { type: "string", enum: ["morning", "afternoon", "evening"] },
        preferredTime: { type: "string" },
        slotChoice: { type: "number" },
        appointmentType: { type: "string" },
      },
      additionalProperties: false,
    },
    confidence: { type: "number" },
    shouldAskClarification: { type: "boolean" },
    clarificationQuestion: { type: "string" },
  },
  required: ["intent", "slotPreference", "confidence", "shouldAskClarification"],
  additionalProperties: false,
};

export class IntentClassifier {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async classify(
    latestMessage: string,
    conversationHistory: Message[],
    hasPendingSlotOffer: boolean,
  ): Promise<IntentClassification> {
    // Contexto resumido da conversa (últimas 8 mensagens para economizar tokens)
    const recentHistory = conversationHistory.slice(-8);
    const historyText = recentHistory
      .map((m) => {
        const role = m.author === "lead" ? "Lead" : "Recepcionista";
        return `${role}: ${m.body}`;
      })
      .join("\n");

    const userContent = [
      hasPendingSlotOffer
        ? "CONTEXTO: Há uma oferta de horários pendente aguardando confirmação do lead."
        : "",
      historyText ? `HISTÓRICO RECENTE:\n${historyText}` : "",
      `ÚLTIMA MENSAGEM DO LEAD: ${latestMessage}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await this.client.chat.completions.create({
      model: MODEL,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "intent_classification",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";

    try {
      const parsed = JSON.parse(raw) as IntentClassification;
      return parsed;
    } catch {
      // Fallback seguro se o JSON vier malformado
      return {
        intent: "unclear",
        slotPreference: {},
        confidence: 0,
        shouldAskClarification: true,
        clarificationQuestion: "Pode me contar mais sobre o que você precisa?",
      };
    }
  }
}
