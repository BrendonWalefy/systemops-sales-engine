import OpenAI from "openai";
import type {
  SalesAgentGateway,
  SalesAgentInput,
  SalesAgentOutput,
} from "@/application/ports/sales-agent-gateway";

const PROMPT_VERSION = "v2";
const MODEL = "gpt-4o-mini";

const BASE_RULES = `Você é a recepcionista virtual de uma clínica. Responda leads no WhatsApp de forma natural, humana e consultiva — nunca robotizada.

Regras gerais:
- Português brasileiro informal mas respeitoso.
- Objetivo principal: agendar uma AVALIAÇÃO GRATUITA.
- Nunca cite valores. Se perguntarem preço, redirecione para a avaliação.
- Se o lead mencionar dor, urgência, sangramento ou emergência: marque handoffRequired como true.
- Máximo 3 parágrafos por resposta. Sem listas longas.
- Use o nome do lead quando disponível.
- Saudação por horário do dia (bom dia / boa tarde / boa noite).
- Mencione o nome da clínica apenas na primeira mensagem.
- Se o lead perguntar algo fora da especialidade da clínica, explique gentilmente e redirecione.
- Sobre horários: NÃO ofereça horários específicos. Pergunte a preferência do lead (manhã/tarde, dia da semana) e informe que a equipe vai confirmar o melhor horário disponível.

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
    const systemPrompt = buildSystemPrompt(input);
    const userPrompt = buildConversationContext(input);

    const response = await this.client.chat.completions.create({
      model: MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
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

function buildSystemPrompt(input: SalesAgentInput): string {
  const { clinic } = input;
  const sections: string[] = [BASE_RULES, "---", "DADOS DA CLÍNICA:"];

  sections.push(`Nome: ${clinic.name}`);
  sections.push(`Especialidade: ${clinic.specialty}`);
  if (clinic.city) sections.push(`Cidade: ${clinic.city}`);
  if (clinic.toneOfVoice) sections.push(`Tom de voz desejado: ${clinic.toneOfVoice}`);
  if (clinic.commercialPolicy) sections.push(`Política comercial: ${clinic.commercialPolicy}`);
  if (clinic.businessHours) sections.push(`Horário de funcionamento: ${clinic.businessHours}`);

  if (clinic.playbook) {
    sections.push("---", "PLAYBOOK DA CLÍNICA (siga estas orientações):", clinic.playbook);
  } else if (input.playbook) {
    sections.push("---", "PLAYBOOK:", input.playbook);
  }

  return sections.join("\n");
}

function buildConversationContext(input: SalesAgentInput): string {
  const leadName = input.lead.name ?? "Lead";
  const lines = [`Lead: ${leadName}`, "Histórico:"];

  for (const msg of input.messages) {
    const author = msg.author === "lead" ? leadName : "Recepcionista";
    lines.push(`${author}: ${msg.body}`);
  }

  return lines.join("\n");
}
