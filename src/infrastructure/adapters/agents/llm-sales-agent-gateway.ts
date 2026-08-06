import OpenAI from "openai";
import type {
  SalesAgentGateway,
  SalesAgentInput,
  SalesAgentOutput,
} from "@/application/ports/sales-agent-gateway";

const PROMPT_VERSION = "v3";
const MODEL = "gpt-4o-mini";

const BASE_RULES = `Você é a especialista comercial com IA de uma clínica. Responda leads no WhatsApp de forma natural, humana e consultiva — nunca robotizada.

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
- Quando o lead perguntar sobre disponibilidade sem informar dia/período, diga que você consultou os próximos 14 dias e pergunte qual dia ou período fica melhor. Não despeje horários aleatórios.
- Quando o lead informar dia ou período e houver horários disponíveis, mencione até 3 horários reais de forma conversacional no suggestedReply e use stage "asked_availability".
- Quando o lead confirmar que quer agendar (ex: "quero marcar", "pode marcar", "reserve as Xh"), use stage "ready_to_schedule" e selecione em offeredSlotIndices o índice do slot que o lead pediu. O suggestedReply deve ser algo como "Perfeito! Confirmando seu horário agora..." — NUNCA diga "confirmado" ou "agendado" pois o sistema ainda vai criar o evento.
- Quando o sistema já tiver enviado as opções numeradas (1, 2, 3) e o lead responder com um número, use stage "ready_to_schedule".
- Se o lead pedir para ver, cancelar ou remarcar agendamento existente, não prometa que a ação já foi feita. Responda de forma breve e deixe o sistema executar a ação real na agenda.
- Se não houver horários disponíveis na seção abaixo, diga que vai verificar e retornar em breve.

Responda APENAS com JSON no formato abaixo, sem markdown:
{
  "leadTemperature": "cold" | "warm" | "hot",
  "stage": "new_lead" | "asked_price" | "asked_availability" | "objection" | "ready_to_schedule" | "clinical_sensitive" | "unresponsive",
  "mainObjection": string | null,
  "suggestedReply": string,
  "offeredSlotIndices": number[],
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
      offeredSlotIndices: Array.isArray(parsed.offeredSlotIndices) ? parsed.offeredSlotIndices.slice(0, 3) : [],
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
  if (clinic.businessHours) sections.push(`Horário de funcionamento: ${clinic.businessHours}`);

  if (input.playbook) {
    sections.push("---", "PLAYBOOK:", input.playbook);
  }

  if (input.availableSlots && input.availableSlots.length > 0) {
    sections.push(
      "---",
      "HORÁRIOS DISPONÍVEIS (índice começa em 0 — use APENAS estes, nunca invente outros):",
    );
    input.availableSlots.forEach((slot, i) => {
      sections.push(`[${i}] ${formatSlotForPrompt(slot.startsAt)}`);
    });
    sections.push(
      "Ao mencionar horários no suggestedReply, use SOMENTE os que estão nessa lista.",
      "Em offeredSlotIndices, informe os índices dos slots que você mencionou/sugeriu ao lead (ex: [0,1] se mencionou os dois primeiros). Máximo 3.",
    );
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
    const author = msg.author === "lead" ? leadName : "Especialista comercial";
    lines.push(`${author}: ${msg.body}`);
  }

  return lines.join("\n");
}

const CLINIC_TZ_OFFSET_MS = -3 * 60 * 60 * 1000; // BRT = UTC-3

function formatSlotForPrompt(date: Date): string {
  const local = new Date(date.getTime() + CLINIC_TZ_OFFSET_MS);
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const dow = weekdays[local.getUTCDay()] ?? "";
  const day = String(local.getUTCDate()).padStart(2, "0");
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const hour = String(local.getUTCHours()).padStart(2, "0");
  return `${dow} ${day}/${month} às ${hour}h`;
}
