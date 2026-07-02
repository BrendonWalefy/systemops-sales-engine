import type { ClinicMetrics } from "./MetricsAggregator";

export type PlaybookGap = {
  type: "missing_objection" | "missing_faq" | "unclear_scenario" | "low_conversion" | "wrong_tone";
  description: string;
  evidence: string[];
  suggestion: string;
  impactEstimate: "high" | "medium" | "low";
};

export type ProposedPlaybook = {
  specialty: string;
  procedureDescription: string;
  toneOfVoice: string;
  differentials: string[];
  commercialPolicy: string;
  objections: Array<{ objection: string; response: string }>;
  greetingMessage: string;
};

export type AdvisorResult = {
  gaps: PlaybookGap[];
  proposedPlaybook: ProposedPlaybook;
  confidenceScore: number;
  reasoning: string;
};

export type CurrentPlaybook = {
  specialty: string;
  procedureDescription: string;
  toneOfVoice: string;
  differentials: string[];
  commercialPolicy: string;
  objections: Array<{ objection: string; response: string }>;
  greetingMessage: string;
};

const ADVISOR_MODEL = process.env.ADVISOR_MODEL ?? "gpt-4o-mini";

async function callAdvisorLLM(prompt: string): Promise<string> {
  // 2000 tokens já cortou a resposta no meio do array "gaps" em produção (JSON
  // truncado → SyntaxError no parse, usuário via só "internal error" sem pista da
  // causa). proposedPlaybook completo + vários gaps facilmente passa de 2000 tokens.
  if (ADVISOR_MODEL.startsWith("claude-")) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: ADVISOR_MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0].type === "text" ? res.content[0].text : "";
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: ADVISOR_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0]?.message?.content ?? "";
}

function buildAdvisorPrompt(metrics: ClinicMetrics, currentPlaybook: CurrentPlaybook): string {
  return `Você é um especialista em otimização de atendimento clínico via WhatsApp. Analise as métricas abaixo e o playbook atual para identificar gaps e sugerir melhorias.

## Métricas dos últimos ${Math.round((metrics.period.to.getTime() - metrics.period.from.getTime()) / 86400000)} dias

- Conversas totais: ${metrics.totalConversations}
- Taxa de mensagens não classificadas (unclear): ${(metrics.unclearRate * 100).toFixed(1)}%
- Taxa de conversas que pediram humano: ${(metrics.needsHumanRate * 100).toFixed(1)}%
- Taxa de abandono após oferta de slots: ${(metrics.dropOffAfterSlotsRate * 100).toFixed(1)}%
- Conversão preço → agendamento: ${(metrics.priceInquiryToBookingRate * 100).toFixed(1)}%
- Taxa de conversão geral: ${(metrics.conversionRate * 100).toFixed(1)}%

### Top intents detectados
${metrics.topIntents.map((i) => `- ${i.intent}: ${i.count} vezes`).join("\n")}

### Mensagens frequentemente não classificadas
${metrics.topUnclearMessages.length > 0 ? metrics.topUnclearMessages.map((m) => `- "${m}"`).join("\n") : "Nenhuma identificada"}

## Playbook atual

Especialidade: ${currentPlaybook.specialty}
Sobre: ${currentPlaybook.procedureDescription}
Tom de voz: ${currentPlaybook.toneOfVoice}
Diferenciais: ${currentPlaybook.differentials.join(", ")}
Política comercial: ${currentPlaybook.commercialPolicy}
Objeções cadastradas: ${currentPlaybook.objections.length}
${currentPlaybook.objections.map((o) => `- Objeção: "${o.objection}" → "${o.response}"`).join("\n")}

Mensagem de saudação:
${currentPlaybook.greetingMessage}

## Sua tarefa

Responda APENAS em JSON válido com esta estrutura exata:

{
  "gaps": [
    {
      "type": "missing_objection" | "missing_faq" | "unclear_scenario" | "low_conversion" | "wrong_tone",
      "description": "descrição objetiva do gap",
      "evidence": ["evidência 1 das métricas", "evidência 2"],
      "suggestion": "o que adicionar ou mudar",
      "impactEstimate": "high" | "medium" | "low"
    }
  ],
  "proposedPlaybook": {
    "specialty": "...",
    "procedureDescription": "...",
    "toneOfVoice": "acolhedor" | "tecnico" | "persuasivo" | "luxo",
    "differentials": ["..."],
    "commercialPolicy": "...",
    "objections": [{"objection": "...", "response": "..."}],
    "greetingMessage": "..."
  },
  "confidenceScore": 0.0,
  "reasoning": "justificativa em 2-3 frases sobre as principais mudanças"
}

Identifique apenas gaps reais com evidência nas métricas. Se não houver gaps significativos, retorne gaps: [] e proposedPlaybook idêntico ao atual com confidenceScore baixo.`;
}

export class PlaybookAdvisor {
  async analyze(metrics: ClinicMetrics, currentPlaybook: CurrentPlaybook): Promise<AdvisorResult> {
    const raw = await callAdvisorLLM(buildAdvisorPrompt(metrics, currentPlaybook));

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("[PlaybookAdvisor] response did not contain valid JSON");
    }

    try {
      return JSON.parse(jsonMatch[0]) as AdvisorResult;
    } catch (err) {
      // JSON truncado (limite de tokens) é a causa mais comum — logar um trecho do
      // fim da resposta ajuda a diferenciar isso de um erro real de formatação.
      throw new Error(
        `[PlaybookAdvisor] failed to parse LLM JSON response (${(err as Error).message}). ` +
          `Tail: ...${jsonMatch[0].slice(-200)}`,
      );
    }
  }
}
