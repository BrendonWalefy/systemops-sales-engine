import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  getVercelSpendWebhookEventKey,
  isValidVercelWebhookSignature,
  parseVercelSpendWebhook,
} from "@/application/finance/vercel-spend-webhook";
import {
  VERCEL_PRO_PLATFORM_FEE_USD_CENTS,
  usdCentsToBrlCents,
  vercelSpendUsdToBrlCents,
} from "@/application/finance/platform-billing";

const SECRET = "vercel-spend-secret";
const body = JSON.stringify({
  teamId: "team-1",
  budgetAmount: 5,
  currentSpend: 4,
  thresholdPercent: 75,
});

describe("Vercel Spend Management webhook", () => {
  it("accepts the SHA-1 HMAC signature sent by Vercel", () => {
    const signature = createHmac("sha1", SECRET).update(body).digest("hex");

    expect(isValidVercelWebhookSignature(body, signature, SECRET)).toBe(true);
    expect(isValidVercelWebhookSignature(body, signature, "wrong")).toBe(false);
  });

  it("parses a spend threshold and creates a stable event key", () => {
    expect(parseVercelSpendWebhook(body)).toEqual({
      kind: "threshold",
      payload: {
        teamId: "team-1",
        budgetAmount: 5,
        currentSpend: 4,
        thresholdPercent: 75,
      },
    });
    expect(getVercelSpendWebhookEventKey(body)).toHaveLength(64);
  });

  it("keeps the Pro platform fee separate from Vercel overage", () => {
    expect(VERCEL_PRO_PLATFORM_FEE_USD_CENTS).toBe(2_000);
    expect(usdCentsToBrlCents(2_000)).toBe(10_300);
    expect(vercelSpendUsdToBrlCents(4)).toBe(2_060);
  });
});
