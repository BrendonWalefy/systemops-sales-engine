export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Vercel permits one schedule per path. Reuse the authenticated campaign handler
// so the weekday evening run keeps the same idempotency and delivery rules.
export { GET } from "@/app/api/cron/recovery-campaign/route";
