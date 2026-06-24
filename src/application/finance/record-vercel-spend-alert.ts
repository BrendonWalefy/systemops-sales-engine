import type { PlatformSpendAlertStore } from "@/application/ports/platform-spend-alert-store";
import type { VercelSpendThreshold } from "@/application/finance/vercel-spend-webhook";

export async function recordVercelSpendAlert(
  payload: VercelSpendThreshold,
  eventKey: string,
  store: PlatformSpendAlertStore,
  now = new Date(),
) {
  return store.record({
    provider: "vercel",
    teamId: payload.teamId,
    budgetAmountUsd: payload.budgetAmount,
    currentSpendUsd: payload.currentSpend,
    thresholdPercent: payload.thresholdPercent,
    eventKey,
    receivedAt: now,
  });
}
