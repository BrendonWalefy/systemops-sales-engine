import OpenAI from "openai";
import type {
  SalesAgentGateway,
  SalesAgentInput,
  SalesAgentOutput,
} from "@/application/ports/sales-agent-gateway";

const PROMPT_VERSION = "v1";
const MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = `Você é a recepcionista virtual de uma clínica odontológica. Seu trabalho é responder leads no WhatsApp de forma natural, humana e consultiva — nunca robotizada.

Regras:
- Responda sempre em português brasileiro informal mas respeitoso.
- Objetivo principal: agendar uma avaliação GRATUITA com o dentista.
- Nunca cite valores de tratamentos. Se perguntarem preço, redirecione para a avaliação.
- Se o lead mencionar dor, inchaço, sangramento, infecção ou emergência: classifique handoffRequired como true.
- Seja conciso (máximo 3 parágrafos). Evite listas longas.
- Use o nome do lead quando disponível.
- Saudação conforme horário do dia (bom dia / boa tarde / boa noite).
- Mencione o nome da clínica na primeira mensagem.

Horários disponíveis para oferecer:
• 28/05 às 15h
• 29/05 às 10h
• 30/05 às 16h

Responda APENAS com JSON no formato abaixo, sem markdown:
{
  "leadTemperature": "cold" | "warm" | "hot",
  "stage": "new_lead" | "asked_price" | "asked_availability" | "objection" | "ready_to_schedule" | "clinical_sensitive" | "unresponsive",
  "mainObjection": string | null,
  "suggestedReply": string,
  "nextAction": string,
  "followUp": string | null,
  "handoffRequired": boolean,
  "riskFlags": string[]
}`;

export class LlmSalesAgentGateway implements SalesAgentGateway {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async analyze(input: SalesAgentInput): Promise<SalesAgentOutput> {
    const clinicContext = buildClinicContext(input);
    const conversationContext = buildConversationContext(input);

    const response = await this.client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${SYSTEM_PROMPT}\n\n${clinicContext}` },
        { role: "user", content: conversationContext },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as Partial<SalesAgentOutput>;

    return {
      leadTemperature: parsed.leadTemperature ?? "warm",
      stage: parsed.stage ?? "new_lead",
      mainObjection: parsed.mainObjection ?? null,
      suggestedReply: parsed.suggestedReply ?? "Olá! Como posso ajudar?",
      nextAction: parsed.nextAction ?? "Aguardar resposta do lead.",
      followUp: parsed.followUp ?? null,
      handoffRequired: parsed.handoffRequired ?? false,
      riskFlags: parsed.riskFlags ?? [],
      confidence: 85,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
          }
        : null,
    };
  }
}

function buildClinicContext(input: SalesAgentInput): string {
  const { clinic } = input;
  const lines = [
    `Clínica: ${clinic.name}`,
    `Especialidade: ${clinic.specialty}`,
  ];
  if (clinic.city) lines.push(`Cidade: ${clinic.city}`);
  if (clinic.toneOfVoice) lines.push(`Tom de voz: ${clinic.toneOfVoice}`);
  if (clinic.commercialPolicy) lines.push(`Política comercial: ${clinic.commercialPolicy}`);
  if (input.playbook) lines.push(`\nPlaybook:\n${input.playbook}`);
  return lines.join("\n");
}

function buildConversationContext(input: SalesAgentInput): string {
  const leadName = input.lead.name ?? "Lead";
  const lines = [`Lead: ${leadName}`, "Histórico da conversa:"];

  for (const msg of input.messages) {
    const author = msg.author === "lead" ? leadName : "Recepcionista";
    lines.push(`${author}: ${msg.body}`);
  }

  lines.push("\nResponda com base no contexto acima.");
  return lines.join("\n");
}
