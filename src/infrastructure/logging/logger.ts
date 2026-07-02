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
  traceId?: string;
  jobId?: string;
  queue?: string;
  route?: string;
  workerId?: string;
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

// Encaminha erros ao Sentry a partir do único canal de falha do app (log.error),
// cobrindo rotas de API, webhook, workers e crons sem instrumentar cada rota.
// Lazy + guardado: em dev/testes (sem produção nem SENTRY_FORCE_ENABLE) nem chega
// a importar o SDK. Non-blocking: telemetria nunca derruba o fluxo principal.
function sentryEnabled(): boolean {
  // A captura no browser é feita pelo SDK client (instrumentation-client).
  if (typeof window !== "undefined") return false;
  return process.env.NODE_ENV === "production" || process.env.SENTRY_FORCE_ENABLE === "1";
}

function forwardErrorToSentry(
  ctx: LogContext,
  message: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!sentryEnabled()) return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        // IDs/labels viram tags (não são PII) para filtrar no dashboard.
        const tags: Record<string, string> = { scope: ctx.scope, log_event: message };
        if (ctx.route) tags.route = ctx.route;
        if (ctx.queue) tags.queue = ctx.queue;
        if (ctx.clinicId) tags.clinic_id = ctx.clinicId;
        scope.setTags(tags);
        // Contexto operacional vai como "extra" (redigido pelo beforeSend).
        scope.setExtras({
          workerId: ctx.workerId,
          jobId: ctx.jobId,
          traceId: ctx.traceId,
          correlationId: ctx.correlationId,
          conversationId: ctx.conversationId,
          ...extra,
        });
        if (err instanceof Error) {
          // Agrupa por (escopo, evento) para estabilidade entre invocações.
          scope.setFingerprint([ctx.scope, message]);
          Sentry.captureException(err);
        } else {
          Sentry.captureMessage(message, "error");
        }
      });
    })
    .catch(() => {
      /* nunca deixe a telemetria derrubar o fluxo principal */
    });
}

export function createLogger(ctx: LogContext): Logger {
  return {
    info: (message, extra) => emit("info", ctx, message, extra),
    warn: (message, extra) => emit("warn", ctx, message, extra),
    error: (message, err, extra) => {
      emit("error", ctx, message, { ...serializeError(err), ...extra });
      forwardErrorToSentry(ctx, message, err, extra);
    },
    child: (extra) => createLogger({ ...ctx, ...extra }),
  };
}
