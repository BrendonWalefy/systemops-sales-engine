/**
 * Helper de LLM compartilhado para chamadas do advisor (ADR-002, conversation-insights, etc).
 * Suporta Claude (Anthropic) e OpenAI baseado no prefixo do modelo.
 *
 * Uso:
 *   const text = await callAdvisorLLM(prompt, { maxTokens: 4000 });
 *
 * Configuração:
 *   SETUP_STUDY_MODEL   — modelo para estudos de setup (default: "claude-sonnet-5")
 *   ADVISOR_MODEL       — modelo legado do conversation-insights (default: "gpt-4o-mini")
 *   ANTHROPIC_API_KEY   — chave da API Anthropic (exigida se o modelo for "claude-*")
 *   OPENAI_API_KEY      — chave da API OpenAI (exigida para modelos OpenAI)
 */

export interface CallLLMOptions {
  /** Modelo a usar. Quando não informado, usa ADVISOR_MODEL ou gpt-4o-mini. */
  model?: string;
  /** Número máximo de tokens na resposta. Default: 2000. */
  maxTokens?: number;
}

/**
 * Chama o LLM configurado e retorna o texto bruto da resposta.
 * Roteamento automático: modelos com prefixo "claude-" → Anthropic, demais → OpenAI.
 */
export async function callAdvisorLLM(
  prompt: string,
  options: CallLLMOptions = {},
): Promise<string> {
  const model =
    options.model || process.env.ADVISOR_MODEL || "gpt-4o-mini";
  const maxTokens = options.maxTokens ?? 2000;

  if (model.startsWith("claude-")) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        `ANTHROPIC_API_KEY ausente — obrigatória para o modelo "${model}". ` +
          `Defina a env no ambiente ou aponte SETUP_STUDY_MODEL/ADVISOR_MODEL para um modelo OpenAI.`,
      );
    }
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0].type === "text" ? res.content[0].text : "";
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      `OPENAI_API_KEY ausente — obrigatória para o modelo "${model}".`,
    );
  }
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0]?.message?.content ?? "";
}

/** Modelo específico para estudos de setup (ADR-002). Modelo forte de
 *  propósito: o estudo é raro por clínica e a qualidade da extração importa
 *  mais que o custo. Requer ANTHROPIC_API_KEY no ambiente. */
export const SETUP_STUDY_MODEL =
  process.env.SETUP_STUDY_MODEL || "claude-sonnet-5";
