/**
 * Vocabulário fechado para a falha de understanding da V2.
 *
 * O Decision Trace registra `status: "failed"` sem qualquer texto, o que protege
 * prompt, mensagem e credencial — mas deixa a operação cega justamente quando
 * precisa agir. Um código fechado diz o que fazer sem carregar um byte do erro
 * original: chave inválida, cota, request recusado e saída inutilizável exigem
 * respostas operacionais diferentes.
 */
export const UNDERSTANDING_FAILURE_CODES = Object.freeze([
  "provider_unauthorized",
  "provider_rate_limited",
  "provider_quota_exhausted",
  "provider_rejected_request",
  "provider_server_error",
  "provider_unreachable",
  "provider_misconfigured",
  "output_missing",
  "output_invalid",
  "aborted",
  "unknown",
] as const);

export type UnderstandingFailureCode = typeof UNDERSTANDING_FAILURE_CODES[number];

const MISSING_OUTPUT_MARKER = "returned no dental understanding output";

function nameOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const name = (error as { name?: unknown }).name;
  if (typeof name === "string" && name.length > 0) return name;
  const ctor = (error as { constructor?: { name?: unknown } }).constructor;
  return typeof ctor?.name === "string" ? ctor.name : null;
}

function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function providerCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function classifyUnderstandingFailure(error: unknown): UnderstandingFailureCode {
  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (name === "AbortError" || name === "TimeoutError") return "aborted";
  }

  if (providerCodeOf(error) === "insufficient_quota") return "provider_quota_exhausted";

  const status = statusOf(error);
  if (status !== null) {
    if (status === 401 || status === 403) return "provider_unauthorized";
    if (status === 429) return "provider_rate_limited";
    if (status >= 500) return "provider_server_error";
    if (status === 400 || status === 404 || status === 422) return "provider_rejected_request";
  }

  // Status explícito é mais específico que a classe, então vem antes. O SDK
  // sinaliza rede e configuração só por classe, sem status: sem isto as duas
  // caem em `unknown` e a operação não sabe se investiga conectividade ou
  // credencial.
  const kind = nameOf(error);
  if (kind === "APIConnectionError" || kind === "APIConnectionTimeoutError") {
    return "provider_unreachable";
  }
  if (kind === "OpenAIError") return "provider_misconfigured";

  if (error instanceof SyntaxError) return "output_invalid";
  if (error instanceof Error && error.message.includes(MISSING_OUTPUT_MARKER)) {
    return "output_missing";
  }
  return "unknown";
}
