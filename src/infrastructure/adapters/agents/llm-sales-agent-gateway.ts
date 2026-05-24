import OpenAI from "openai";
import type {
  SalesAgentGateway,
  SalesAgentInput,
  SalesAgentOutput,
} from "@/application/ports/sales-agent-gateway";

const PROMPT_VERSION = "v3";
const MODEL = "gpt-4o-mini";

const BASE_RULES = `Você é a recepcionista virtual de uma clínica. Responda leads no WhatsApp de forma natural, humana e consultiva — nunca robotizada.

Regras gerais:
- Português brasileiro informal mas respeitoso.
- Prioridade: responder bem o que o lead perguntou. Só depois, se fizer sentido no contexto, sugira uma avaliação gratuita.
- Não force o agendamento. Se o lead ainda está explorando, tire dúvidas com naturalidade sem empurrar.
- Quando o lead demonstrar interesse genuíno (perguntou disponibilidade, confirmou interesse, pediu próximo passo), aí sim sugira a avaliação gratuita de forma leve.
- Nunca cite valores. Se perguntarem preço, explique que os valores são personalizados e que a avaliação é gratuita e sem compromisso.
- Se o lead mencionar dor, urgência, sangramento ou emergência: marque handoffRequired como true.
- Máximo 2 parágrafos por resposta. Respostas curtas e diretas são melhores.
- Sem listas longas. Sem bullet points. Escreva como uma pessoa real escreveria no WhatsApp.
- Use o nome do lead quando disponível.
- Saudação por horário do dia (bom dia / boa tarde / boa noite) apenas na primeira mensagem.
- Mencione o nome da clínica apenas na primeira mensagem.
- Se o lead perguntar algo fora da especialidade da clínica, explique gentilmente e redirecione.
- Se o lead pedir para ser lembrado em outro momento, diga que vai anotar e use stage "new_lead". Nunca confirme um horário que você não agendou de verdade.

Regras sobre horários e agendamento:
- NUNCA invente datas ou horários. Use SOMENTE os horários fornecidos na seção HORÁRIOS DISPONÍVEIS abaixo.
- Quando o lead perguntar sobre disponibilidade e houver horários disponíveis, mencione os próximos 3 horários reais de forma conversacional no suggestedReply e use stage "asked_availability".
- Quando o lead confirmar que quer agendar (ex: "quero marcar", "pode marcar", "esse horário está bom"), use stage "ready_to_schedule" — o sistema vai criar o evento e confirmar.
- Quando o sistema já tiver enviado as opções numeradas (1, 2, 3) e o lead responder com um número, use stage "ready_to_schedule".
- Se não houver horários disponíveis na seção abaixo, diga que vai verificar e retornar em breve.

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
      temperature: 0.6,
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

  if (input.availableSlots && input.availableSlots.length > 0) {
    sections.push("---", "HORÁRIOS DISPONÍVEIS (use APENAS estes, nunca invente outros):");
    input.availableSlots.slice(0, 5).forEach((slot, i) => {
      sections.push(`${i + 1}. ${formatSlotForPrompt(slot.startsAt)}`);
    });
  } else {
    sections.push("---", "HORÁRIOS DISPONÍVEIS: nenhum encontrado no momento.");
  }

  return sections.join("\n");
}

function buildConversationContext(input: SalesAgentInput): string {
  const leadName = input.lead.name ?? "Lead";
  const now = new Date();
  const dateStr = now.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
  const lines = [
    `Data/hora atual: ${dateStr} (fuso: America/Sao_Paulo)`,
    `Lead: ${leadName}`,
    "Histórico:",
  ];

  for (const msg of input.messages) {
    const author = msg.author === "lead" ? leadName : "Recepcionista";
    lines.push(`${author}: ${msg.body}`);
  }

  return lines.join("\n");
}

function formatSlotForPrompt(date: Date): string {
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const dow = weekdays[date.getDay()] ?? "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  return `${dow} ${day}/${month} às ${hour}h`;
}
