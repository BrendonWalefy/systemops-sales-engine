// Logger estruturado em JSON de linha única — compatível com Vercel Logs.
// Sem dependência externa: envolve console com contexto fixo (correlationId,
// clinicId, conversationId) para permitir busca e correlação em produção.
//
// Uso:
//   const log = createLogger({ scope: "Orchestrator", correlationId: messageId, clinicId });
//   log.info("mensagem recebida", { intent });
//   log.warn("mídia não encontrada", { mediaId });
//   log.error("falha no envio", err, { partIndex });

export type LogContext = {
  scope: string;
  correlationId?: string;
  clinicId?: string;
  conversationId?: string;
};

export type Logger = {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, err?: unknown, extra?: Record<string, unknown>): void;
  child(extra: Partial<LogContext>): Logger;
};

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { errorMessage: err.message, errorName: err.name, stack: err.stack?.split("\n").slice(0, 5).join(" | ") };
  }
  if (err === undefined) return {};
  return { errorMessage: String(err) };
}

function emit(
  level: "info" | "warn" | "error",
  ctx: LogContext,
  message: string,
  extra?: Record<string, unknown>,
): void {
  const line = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    msg: message,
    ...ctx,
    ...extra,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(ctx: LogContext): Logger {
  return {
    info: (message, extra) => emit("info", ctx, message, extra),
    warn: (message, extra) => emit("warn", ctx, message, extra),
    error: (message, err, extra) => emit("error", ctx, message, { ...serializeError(err), ...extra }),
    child: (extra) => createLogger({ ...ctx, ...extra }),
  };
}
