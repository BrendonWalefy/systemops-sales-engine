// Inicialização do Sentry no browser. Carregado automaticamente pelo Next.js.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/infrastructure/logging/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Inerte em dev local; ativo em preview/produção. Para testar localmente,
  // defina NEXT_PUBLIC_SENTRY_FORCE_ENABLE=1.
  enabled:
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_SENTRY_FORCE_ENABLE === "1",
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  // Sem Session Replay: evita gravar telas com dados de paciente (LGPD) e
  // preserva a cota gratuita. Sem tracing de performance pelo mesmo motivo.
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});

// Instrumenta as transições de rota do App Router.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
