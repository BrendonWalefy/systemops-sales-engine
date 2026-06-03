/**
 * FieldComposer — lapida um campo do playbook usando APENAS os fatos fornecidos.
 *
 * Regras anti-alucinação:
 * - Nunca inventa valores, preços, condições, prazos ou afirmações clínicas.
 * - Melhora clareza, tom e formato, não conteúdo factual.
 * - Se um fato necessário estiver ausente, lista em `missingFacts` e NÃO preenche.
 * - Saída validada pelo fact-guard determinístico após retorno do LLM.
 */

import { findUnsupportedNumbers } from "@/lib/fact-guard";

export type FieldTarget =
  | "procedureDescription"
  | "toneOfVoice"
  | "commercialPolicy"
  | "differentials"
  | "objections"
  | "notes"
  | "greetingMessage";

export type FieldRewriteResult = {
  proposedText: string;
  factsUsed: string[];
  missingFacts: string[];
};

type ClinicContext = {
  specialty: string;
  toneOfVoice: string;
};

const SENSITIVE_FIELDS: FieldTarget[] = ["commercialPolicy", "greetingMessage", "objections"];

const FIELD_INSTRUCTIONS: Record<FieldTarget, string> = {
  notes:
    "Reescreva como uma lista de regras de comportamento curtas e diretas para a recepcionista virtual. Formato: bullet points com '-'. Começa com 'COMO CONDUZIR A CONVERSA:'.",
  procedureDescription:
    "Reescreva como uma descrição clara e consultiva dos procedimentos. Máximo 4 linhas. Sem inventar especificidades técnicas.",
  toneOfVoice:
    "Reescreva como uma instrução de tom concisa (1-2 frases). Ex: 'Profissional e consultivo, sem gírias, nunca insistente.'",
  commercialPolicy:
    "Reescreva como regras claras de política comercial. NUNCA invente valor, prazo ou condição. Liste em `missingFacts` qualquer dado ausente.",
  differentials:
    "Reescreva como bullet points de diferenciais da clínica. Um por linha, começando com '-'. Sem inventar diferenciais não mencionados.",
  objections:
    "Reescreva o par objeção-resposta em formato 'Objeção: ... \\nResposta: ...'. Resposta natural para WhatsApp.",
  greetingMessage:
    "Reescreva a mensagem de boas-vindas. Curta, acolhedora, no tom da clínica. NUNCA mencione valores ou promoções não informadas.",
};

const ADVISOR_MODEL = process.env.ADVISOR_MODEL ?? "gpt-4o-mini";

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  if (ADVISOR_MODEL.startsWith("claude-")) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model: ADVISOR_MODEL,
      max_tokens: 1000,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return res.content[0].type === "text" ? res.content[0].text : "";
  }

  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model: ADVISOR_MODEL,
    max_tokens: 1000,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

function buildSystemPrompt(field: FieldTarget, context: ClinicContext): string {
  return `Você é um assistente especialista em comunicação para clínicas de saúde via WhatsApp.

MISSÃO: reescrever o campo "${field}" do playbook da clínica a partir dos fatos fornecidos pelo dono.

TOM DA CLÍNICA: ${context.toneOfVoice || "Profissional e acolhedor"}.
ESPECIALIDADE: ${context.specialty || "Clínica de saúde"}.

REGRAS ABSOLUTAS (violação = resposta inválida):
1. Reescreva e estruture APENAS os fatos fornecidos pelo usuário e o valor atual do campo. Melhore clareza, tom e formato — NÃO o conteúdo factual.
2. NUNCA invente valores, preços, condições de pagamento, prazos, diferenciais ou afirmações clínicas não mencionadas.
3. Se um fato necessário não foi fornecido, NÃO preencha: liste em missingFacts como uma pergunta curta ao dono.
4. Frases curtas, naturais para WhatsApp. Máximo 2 linhas por ponto.
5. Instrução de campo: ${FIELD_INSTRUCTIONS[field]}

Retorne APENAS JSON válido no formato:
{
  "proposedText": "texto reescrito aqui",
  "factsUsed": ["fato 1 extraído do input", "fato 2"],
  "missingFacts": ["Pergunta sobre fato ausente?"]
}`;
}

/**
 * Lapida um campo do playbook. Roda o fact-guard após retorno do LLM.
 * Para campos sensíveis, rejeita a proposta se contiver número inventado.
 */
export async function composeField(input: {
  field: FieldTarget;
  userInput: string;
  currentValue: string;
  clinicContext: ClinicContext;
}): Promise<FieldRewriteResult> {
  const { field, userInput, currentValue, clinicContext } = input;

  const systemPrompt = buildSystemPrompt(field, clinicContext);
  const userPrompt = `VALOR ATUAL DO CAMPO:\n${currentValue || "(vazio)"}\n\nO QUE O DONO ESCREVEU:\n${userInput}`;

  const raw = await callLLM(systemPrompt, userPrompt);

  let parsed: FieldRewriteResult;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? raw) as FieldRewriteResult;
  } catch {
    return {
      proposedText: currentValue,
      factsUsed: [],
      missingFacts: ["Não foi possível processar a resposta. Tente novamente."],
    };
  }

  if (!parsed.proposedText || typeof parsed.proposedText !== "string") {
    return {
      proposedText: currentValue,
      factsUsed: [],
      missingFacts: ["Resposta da IA inválida. Tente novamente."],
    };
  }

  const unsupported = findUnsupportedNumbers(parsed.proposedText, userInput + " " + currentValue);

  if (unsupported.length > 0 && SENSITIVE_FIELDS.includes(field)) {
    const questions = unsupported.map((n) => `Confirme o valor ${n} mencionado.`);
    return {
      proposedText: currentValue,
      factsUsed: parsed.factsUsed ?? [],
      missingFacts: [...(parsed.missingFacts ?? []), ...questions],
    };
  }

  return {
    proposedText: parsed.proposedText,
    factsUsed: Array.isArray(parsed.factsUsed) ? parsed.factsUsed : [],
    missingFacts: Array.isArray(parsed.missingFacts) ? parsed.missingFacts : [],
  };
}
