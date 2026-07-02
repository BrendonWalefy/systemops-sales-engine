// Inicialização do Sentry no runtime Edge (route handlers/middleware edge).
// Carregado por src/instrumentation.ts quando NEXT_RUNTIME === "edge".
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/infrastructure/logging/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production" || process.env.SENTRY_FORCE_ENABLE === "1",
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});
