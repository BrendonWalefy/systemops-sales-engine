import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "crypto";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  recordVercelSpendAlert: vi.fn(),
  createLogger: vi.fn(),
}));

vi.mock("@/application/finance/record-vercel-spend-alert", () => ({
  recordVercelSpendAlert: mocks.recordVercelSpendAlert,
}));

vi.mock("@/infrastructure/repositories/drizzle-platform-spend-alert-store", () => ({
  DrizzlePlatformSpendAlertStore: class {},
}));

vi.mock("@/infrastructure/logging/logger", () => ({
  createLogger: mocks.createLogger,
}));

import { POST } from "@/app/api/webhooks/vercel/spend/route";

const SECRET = "vercel-spend-secret";
const payload = {
  teamId: "team-1",
  budgetAmount: 5,
  currentSpend: 4,
  thresholdPercent: 75,
};

function request(body = JSON.stringify(payload), signature?: string): NextRequest {
  return new NextRequest("http://systemops.test/api/webhooks/vercel/spend", {
    method: "POST",
    headers: signature ? { "x-vercel-signature": signature } : {},
    body,
  });
}

describe("Vercel Spend Management webhook route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_SPEND_WEBHOOK_SECRET = SECRET;
    process.env.VERCEL_TEAM_ID = "team-1";
    mocks.recordVercelSpendAlert.mockResolvedValue({
      alert: { teamId: "team-1", thresholdPercent: 75, currentSpendUsd: 4, budgetAmountUsd: 5 },
      isNew: true,
    });
    mocks.createLogger.mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
  });

  it("records a signed threshold event from the configured team", async () => {
    const body = JSON.stringify(payload);
    const signature = createHmac("sha1", SECRET).update(body).digest("hex");

    const response = await POST(request(body, signature));

    expect(response.status).toBe(200);
    expect(mocks.recordVercelSpendAlert).toHaveBeenCalledWith(
      payload,
      expect.any(String),
      expect.anything(),
    );
  });

  it("rejects a request with an invalid signature", async () => {
    const response = await POST(request(JSON.stringify(payload), "invalid"));

    expect(response.status).toBe(401);
    expect(mocks.recordVercelSpendAlert).not.toHaveBeenCalled();
  });

  it("rejects a valid request from another Vercel team", async () => {
    const body = JSON.stringify({ ...payload, teamId: "other-team" });
    const signature = createHmac("sha1", SECRET).update(body).digest("hex");

    const response = await POST(request(body, signature));

    expect(response.status).toBe(401);
    expect(mocks.recordVercelSpendAlert).not.toHaveBeenCalled();
  });
});
