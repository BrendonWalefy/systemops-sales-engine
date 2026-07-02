// Inicialização do Sentry no runtime Node (servidor).
// Carregado por src/instrumentation.ts quando NEXT_RUNTIME === "nodejs".
//
// Privacidade (LGPD): sendDefaultPii=false + redação extra no beforeSend.
// NUNCA anexe dados de paciente aos eventos.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/infrastructure/logging/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Só reporta em deploy (Vercel preview/produção). Em dev local fica inerte
  // para não gastar a cota gratuita (5k eventos/mês) com erros de desenvolvimento.
  // Para testar localmente, defina SENTRY_FORCE_ENABLE=1.
  enabled: process.env.NODE_ENV === "production" || process.env.SENTRY_FORCE_ENABLE === "1",
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // Erros primeiro: sem tracing de performance, para preservar a cota gratuita.
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
});
