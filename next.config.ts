import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? "systemops-yp",
  project: process.env.SENTRY_PROJECT ?? "javascript-nextjs",
  // Secret presente apenas no build da Vercel. Sem ele, o build segue sem
  // upload de source maps (stack traces ficam minificados, mas os erros chegam).
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  // Remove os logs do próprio SDK do bundle do cliente.
  disableLogger: true,
  telemetry: false,
});
