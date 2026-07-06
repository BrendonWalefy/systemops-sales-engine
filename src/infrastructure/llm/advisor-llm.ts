/**
 * Helper de LLM compartilhado para chamadas do advisor (ADR-002, conversation-insights, etc).
 * Suporta Claude (Anthropic) e OpenAI baseado no prefixo do modelo.
 *
 * Uso:
 *   const text = await callAdvisorLLM(prompt, { maxTokens: 4000 });
 *
 * Configuração:
 *   SETUP_STUDY_MODEL   — modelo para estudos de setup (default: "claude-sonnet-4-5")
 *   ADVISOR_MODEL       — modelo legado do conversation-insights (default: "gpt-4o-mini")
 *   ANTHROPIC_API_KEY   — chave da API Anthropic
 *   OPENAI_API_KEY      — chave da API OpenAI
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
    options.model ?? process.env.ADVISOR_MODEL ?? "gpt-4o-mini";
  const maxTokens = options.maxTokens ?? 2000;

  if (model.startsWith("claude-")) {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0].type === "text" ? res.content[0].text : "";
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

/** Modelo específico para estudos de setup (ADR-002). */
export const SETUP_STUDY_MODEL =
  process.env.SETUP_STUDY_MODEL ?? "claude-sonnet-4-5";
