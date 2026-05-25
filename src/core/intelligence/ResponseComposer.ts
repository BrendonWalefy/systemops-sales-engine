// LLM Estágio 2: Humaniza o resultado de uma ação já executada.
// NUNCA inventa horários ou dados. Recebe fatos concretos e verbaliza em tom humano.
// Separado do IntentClassifier para garantir que lógica e linguagem não se misturem.

import OpenAI from "openai";
import type { Message } from "@/domain/entities/conversation";
import type { FormattedSlot } from "@/core/conversation/ConversationStateMachine";
import type { ClinicTimezone } from "@/core/scheduling/ClinicTimezone";

const MODEL = "gpt-4o-mini";
const PROMPT_VERSION = "composer-v1";

export type FormattedAppointment = {
  label: string;   // "Seg 26/05 às 14h"
  status: string;  // "scheduled" | "confirmed"
};

export type ActionResult =
  | {
      type: "slots_found";
      slots: FormattedSlot[];
      askedForPreference: boolean; // se true, LLM perguntou período antes
    }
  | { type: "appointment_confirmed"; slot: FormattedSlot; clinicName: string }
  | { type: "appointment_cancelled"; count?: number }
  | { type: "appointment_rescheduled"; newSlots: FormattedSlot[] }
  | { type: "no_slots_available"; nextAvailableDate?: string }
  | { type: "clarification_needed"; question: string }
  | { type: "appointments_listed"; appointments: FormattedAppointment[] }
  | { type: "no_appointments" }
  | { type: "clinical_urgency" }
  | { type: "handoff_requested" }
  | { type: "price_inquiry" }
  | { type: "general_question"; clinicContext: string }
  | { type: "greeting" };

export type ComposerInput = {
  actionResult: ActionResult;
  conversationHistory: Message[];
  clinic: {
    name: string;
    specialty: string;
    toneOfVoice: string | null;
    playbook: string | null;
    commercialPolicy: string | null;
  };
  leadName?: string | null;
  timezone: ClinicTimezone;
  isFirstMessage: boolean;
};

export type ComposedResponse = {
  text: string;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
};

function buildSystemPrompt(input: ComposerInput): string {
  const { clinic, leadName, timezone, isFirstMessage } = input;
  const nowStr = timezone.formatNowForPrompt();

  return `Você é a recepcionista virtual da ${clinic.name}, uma clínica de ${clinic.specialty}.

IDENTIDADE:
- Tom de voz: ${clinic.toneOfVoice ?? "informal e acolhedor"}
- ${leadName ? `Nome do lead: ${leadName}` : "Nome do lead: desconhecido (não invente)"}
- Data/hora atual: ${nowStr}
${isFirstMessage ? `- É a primeira mensagem: mencione o nome da clínica uma vez` : "- Não mencione o nome da clínica novamente"}

REGRAS ABSOLUTAS:
1. Máximo 2 parágrafos curtos. Sem bullet points. Sem listas numeradas. Escreva como pessoa real.
2. NUNCA invente horários, datas ou informações que não estão no contexto fornecido.
3. Se houver horários disponíveis na ação, os mencione EXATAMENTE como fornecidos — não reformule datas.
4. Use o nome do lead com naturalidade, não em toda frase.
5. Não use emojis em excesso — no máximo 1 por mensagem e só se o tom for informal.
6. Não escreva "Olá" ou saudação se não for a primeira mensagem.
7. NÃO repita informações já dadas ao lead nesta conversa (ex: valor da avaliação, endereço, formas de pagamento). Só repita se o lead perguntar novamente de forma explícita.
${clinic.commercialPolicy ? `\nPOLÍTICA COMERCIAL:\n${clinic.commercialPolicy}` : ""}
${clinic.playbook ? `\nORIENTAÇÕES DA CLÍNICA:\n${clinic.playbook}` : ""}`;
}

function buildActionContext(result: ActionResult): string {
  switch (result.type) {
    case "slots_found": {
      const slotList = result.slots.map((s) => `  Opção ${s.index}: ${s.label}`).join("\n");
      return `AÇÃO EXECUTADA: Encontramos horários disponíveis. Apresente-os ao lead pedindo que escolha um (responda com o número).
REGRA CRÍTICA: Use EXATAMENTE os labels abaixo. NÃO altere datas, horas ou dias. NÃO use horários do histórico da conversa.
HORÁRIOS DISPONÍVEIS:
${slotList}`;
    }

    case "appointment_confirmed":
      return `AÇÃO EXECUTADA: Agendamento confirmado com sucesso.
HORÁRIO CONFIRMADO: ${result.slot.label}
CLÍNICA: ${result.clinicName}
Informe o lead de forma calorosa. Diga que a equipe estará esperando. Não peça confirmação novamente.`;

    case "appointment_cancelled": {
      const qty = result.count && result.count > 1 ? `${result.count} agendamentos` : "o agendamento";
      return `AÇÃO EXECUTADA: ${qty} cancelado(s) com sucesso. NÃO mencione horários específicos — apenas confirme o cancelamento de forma gentil e deixe a porta aberta para um novo agendamento.`;
    }

    case "appointment_rescheduled": {
      const slotList = result.newSlots.map((s) => `  Opção ${s.index}: ${s.label}`).join("\n");
      return `AÇÃO EXECUTADA: Agendamento anterior cancelado. Apresente os novos horários disponíveis.
REGRA CRÍTICA: Use EXATAMENTE os labels abaixo. NÃO altere datas, horas ou dias. NÃO use horários do histórico da conversa.
NOVOS HORÁRIOS:
${slotList}`;
    }

    case "no_slots_available":
      return `AÇÃO EXECUTADA: Não há horários disponíveis no período solicitado.
${result.nextAvailableDate ? `Próximo horário disponível: ${result.nextAvailableDate}` : ""}
Informe gentilmente e ofereça alternativas ou peça para o lead sugerir outro período.`;

    case "clarification_needed":
      return `AÇÃO EXECUTADA: Precisamos de mais informações.
PERGUNTA A FAZER: ${result.question}
Faça a pergunta de forma natural e acolhedora.`;

    case "appointments_listed": {
      const apptList = result.appointments.map((a) => `  - ${a.label}`).join("\n");
      return `AÇÃO EXECUTADA: Listamos os agendamentos do lead.
AGENDAMENTOS:
${apptList}
Apresente-os de forma clara e pergunte se pode ajudar com mais alguma coisa.`;
    }

    case "no_appointments":
      return `AÇÃO EXECUTADA: Lead não tem agendamentos ativos.
Informe gentilmente e ofereça agendar uma avaliação.`;

    case "clinical_urgency":
      return `AÇÃO EXECUTADA: Detectada urgência clínica.
Demonstre empatia, informe que irá acionar a equipe imediatamente e diga que alguém entrará em contato. Não minimize a situação.`;

    case "handoff_requested":
      return `AÇÃO EXECUTADA: Necessário atendimento humano.
Informe o lead que um membro da equipe irá assumir o atendimento em breve. Seja acolhedor.`;

    case "price_inquiry":
      return `AÇÃO EXECUTADA: Lead perguntou sobre preço.
Não informe valores. Explique que a avaliação inicial é gratuita e é o melhor passo para entender as opções e investimento. Convide para agendar.`;

    case "general_question":
      return `AÇÃO EXECUTADA: Pergunta geral sobre a clínica.
CONTEXTO DA CLÍNICA: ${result.clinicContext}
Responda de forma informativa e acolhedora.`;

    case "greeting":
      return `AÇÃO EXECUTADA: Lead enviou saudação.
Responda com calor, pergunte como pode ajudar.`;
  }
}

export class ResponseComposer {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async compose(input: ComposerInput): Promise<ComposedResponse> {
    const systemPrompt = buildSystemPrompt(input);
    const actionContext = buildActionContext(input.actionResult);

    // Histórico recente — filtra mensagens de sistema (marcadores internos como __appointment_confirmed__)
    // para evitar que o LLM use dados de agendamentos anteriores como referência de horários
    const recentHistory = input.conversationHistory
      .filter((m) => m.author !== "system" && !m.body.startsWith("__"))
      .slice(-6);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      ...recentHistory.map((m): OpenAI.Chat.ChatCompletionMessageParam => ({
        role: m.author === "lead" ? "user" : "assistant",
        content: m.body,
      })),
      {
        role: "user",
        content: `[INSTRUÇÃO INTERNA — NÃO VISÍVEL AO LEAD]\n${actionContext}\n\nEscreva a resposta agora:`,
      },
    ];

    const response = await this.client.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 300,
      messages,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";

    return {
      text,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }
}
