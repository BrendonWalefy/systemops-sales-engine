import { describe, expect, it, vi } from "vitest";
import { recordVercelSpendAlert } from "@/application/finance/record-vercel-spend-alert";

describe("recordVercelSpendAlert", () => {
  it("persists the Vercel threshold as a platform-wide event", async () => {
    const store = {
      record: vi.fn().mockResolvedValue({ alert: {}, isNew: true }),
      findLatest: vi.fn(),
    };
    const now = new Date("2026-06-24T00:00:00.000Z");

    await recordVercelSpendAlert(
      { teamId: "team-1", budgetAmount: 5, currentSpend: 4, thresholdPercent: 75 },
      "event-key",
      store,
      now,
    );

    expect(store.record).toHaveBeenCalledWith({
      provider: "vercel",
      teamId: "team-1",
      budgetAmountUsd: 5,
      currentSpendUsd: 4,
      thresholdPercent: 75,
      eventKey: "event-key",
      receivedAt: now,
    });
  });
});
