import { createHash, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const spendThresholdSchema = z.object({
  budgetAmount: z.number().int().nonnegative(),
  currentSpend: z.number().int().nonnegative(),
  teamId: z.string().min(1),
  thresholdPercent: z.union([z.literal(50), z.literal(75), z.literal(100)]),
});

const billingCycleEndedSchema = z.object({
  teamId: z.string().min(1),
  type: z.literal("endOfBillingCycle"),
});

export type VercelSpendThreshold = z.infer<typeof spendThresholdSchema>;

export function parseVercelSpendWebhook(body: string):
  | { kind: "threshold"; payload: VercelSpendThreshold }
  | { kind: "billing_cycle_ended"; teamId: string }
  | null {
  try {
    const data: unknown = JSON.parse(body);
    const threshold = spendThresholdSchema.safeParse(data);
    if (threshold.success) return { kind: "threshold", payload: threshold.data };

    const billingCycleEnded = billingCycleEndedSchema.safeParse(data);
    if (billingCycleEnded.success) {
      return { kind: "billing_cycle_ended", teamId: billingCycleEnded.data.teamId };
    }
  } catch {
    // The public webhook must reject malformed payloads without exposing details.
  }

  return null;
}

export function isValidVercelWebhookSignature(
  body: string,
  signature: string | null,
  secret: string | undefined,
): boolean {
  if (!signature || !secret) return false;

  const received = signature.trim().replace(/^sha1=/i, "");
  const expected = createHmac("sha1", secret).update(body).digest("hex");
  if (received.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function getVercelSpendWebhookEventKey(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}
