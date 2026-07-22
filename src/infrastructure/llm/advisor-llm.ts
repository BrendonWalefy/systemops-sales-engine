/**
 * Helper de LLM compartilhado para chamadas do advisor (ADR-002, conversation-insights, etc).
 * Suporta Claude (Anthropic) e OpenAI baseado no prefixo do modelo.
 *
 * Uso:
 *   const text = await callAdvisorLLM(prompt, { maxTokens: 4000 });
 *   const { text, inputTokens } = await callAdvisorLLMWithUsage(prompt);
 *
 * Configuração:
 *   SETUP_STUDY_MODEL   — modelo para estudos de setup (default: "claude-sonnet-5")
 *   REACTIVATION_MODEL  — modelo do Motor de Reativação (default: "claude-sonnet-5")
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

export type AdvisorLLMResult = {
  text: string;
  model: string;
  provider: "anthropic" | "openai";
  inputTokens: number;
  outputTokens: number;
};

/**
 * Chama o LLM configurado e retorna o texto bruto da resposta.
 * Roteamento automático: modelos com prefixo "claude-" → Anthropic, demais → OpenAI.
 */
export async function callAdvisorLLM(
  prompt: string,
  options: CallLLMOptions = {},
): Promise<string> {
  const result = await callAdvisorLLMWithUsage(prompt, options);
  return result.text;
}

/**
 * Mesma chamada, devolvendo também o consumo de tokens.
 *
 * Existe porque `callAdvisorLLM` descartava `usage` — o que deixava todo o
 * gasto de LLM do advisor, do conversation-insights e do setup study invisível
 * em `ai_usage_costs`. Quem precisa registrar custo (Motor de Reativação, ADR-009)
 * usa esta versão; os callers antigos seguem no wrapper acima sem mudança.
 */
export async function callAdvisorLLMWithUsage(
  prompt: string,
  options: CallLLMOptions = {},
): Promise<AdvisorLLMResult> {
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
    // Resposta truncada é inútil para os callers (todos parseiam JSON) e o
    // bloco de thinking do modelo consome do mesmo orçamento de max_tokens.
    if (res.stop_reason === "max_tokens") {
      throw new Error(
        `Resposta do LLM truncada em ${maxTokens} tokens (modelo "${model}"). ` +
          `Aumente maxTokens na chamada.`,
      );
    }
    const textBlock = res.content.find((b) => b.type === "text");
    return {
      text: textBlock && textBlock.type === "text" ? textBlock.text : "",
      model,
      provider: "anthropic",
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    };
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
  if (res.choices[0]?.finish_reason === "length") {
    throw new Error(
      `Resposta do LLM truncada em ${maxTokens} tokens (modelo "${model}"). ` +
        `Aumente maxTokens na chamada.`,
    );
  }
  return {
    text: res.choices[0]?.message?.content ?? "",
    model,
    provider: "openai",
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
  };
}

/** Modelo específico para estudos de setup (ADR-002). Modelo forte de
 *  propósito: o estudo é raro por clínica e a qualidade da extração importa
 *  mais que o custo. Requer ANTHROPIC_API_KEY no ambiente. */
export const SETUP_STUDY_MODEL =
  process.env.SETUP_STUDY_MODEL || "claude-sonnet-5";

/** Modelo do Motor de Reativação (ADR-009): classificar motivo de não-fechamento
 *  e redigir rascunhos de campanha. Roda assíncrono, fora do caminho do
 *  WhatsApp — qualidade vale mais que latência aqui, e o volume é baixo o
 *  bastante para o custo não ser o fator decisivo (ver ADR-009 §Custo).
 *  Trocável por env sem mudar código. */
export const REACTIVATION_MODEL =
  process.env.REACTIVATION_MODEL || "claude-sonnet-5";
