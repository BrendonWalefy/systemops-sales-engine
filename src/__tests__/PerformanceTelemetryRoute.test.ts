import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionClinicId: vi.fn(),
  createLogger: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  getSessionClinicId: mocks.getSessionClinicId,
}));

vi.mock("@/infrastructure/logging/logger", () => ({
  createLogger: mocks.createLogger,
}));

import { POST } from "@/app/api/telemetry/performance/route";

const VALID_SAMPLE = {
  schemaVersion: 1,
  source: "client",
  surface: "inbox_list",
  operation: "soft_navigation",
  durationMs: 145,
  cacheState: "unknown",
  outcome: "ok",
};

function requestWith(payload: unknown, headers?: HeadersInit): Request {
  return new Request("http://systemops.test/api/telemetry/performance", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}

describe("performance telemetry route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PERFORMANCE_TELEMETRY_ENABLED", "1");
    mocks.getSessionClinicId.mockResolvedValue("server-clinic-id");
    mocks.createLogger.mockReturnValue({ info: mocks.logInfo });
  });

  it("does not authenticate or read the body while telemetry is off", async () => {
    vi.stubEnv("PERFORMANCE_TELEMETRY_ENABLED", "0");
    const request = requestWith(VALID_SAMPLE);
    const getReader = vi.spyOn(request.body!, "getReader");

    expect((await POST(request)).status).toBe(204);
    expect(mocks.getSessionClinicId).not.toHaveBeenCalled();
    expect(getReader).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getSessionClinicId.mockResolvedValue(null);

    expect((await POST(requestWith(VALID_SAMPLE))).status).toBe(401);
    expect(mocks.createLogger).not.toHaveBeenCalled();
  });

  it("rejects declared or streamed payloads over 4096 bytes", async () => {
    const declared = requestWith(VALID_SAMPLE, { "content-length": "4097" });
    const streamed = requestWith({ ...VALID_SAMPLE, padding: "x".repeat(4096) });

    expect((await POST(declared)).status).toBe(413);
    expect((await POST(streamed)).status).toBe(413);
    expect(mocks.createLogger).not.toHaveBeenCalled();
  });

  it("rejects malformed, unknown-field, and non-client payloads", async () => {
    const malformed = new Request("http://systemops.test/api/telemetry/performance", {
      method: "POST",
      body: "{",
    });

    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(requestWith({ ...VALID_SAMPLE, pathname: "/app/inbox/private-id" }))).status).toBe(400);
    expect((await POST(requestWith({ ...VALID_SAMPLE, source: "server" }))).status).toBe(400);
    expect(mocks.createLogger).not.toHaveBeenCalled();
  });

  it("accepts all client operations, including content_ready and app_first_open", async () => {
    const contentReadySample = { ...VALID_SAMPLE, operation: "content_ready", cacheState: "warm" };
    const appFirstOpenSample = { ...VALID_SAMPLE, operation: "app_first_open" };
    const dashboardSample = { ...VALID_SAMPLE, operation: "dashboard_total" };

    expect((await POST(requestWith(contentReadySample))).status).toBe(204);
    expect((await POST(requestWith(appFirstOpenSample))).status).toBe(204);
    expect((await POST(requestWith(dashboardSample))).status).toBe(204);
  });

  it("logs only the strict sample under the server-resolved clinic id", async () => {
    const response = await POST(requestWith(VALID_SAMPLE));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(mocks.createLogger).toHaveBeenCalledWith({
      scope: "PerformanceTelemetry",
      clinicId: "server-clinic-id",
    });
    expect(mocks.logInfo).toHaveBeenCalledWith("performance.sample", VALID_SAMPLE);
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "performance.sample",
      expect.not.objectContaining({ pathname: expect.anything() }),
    );
  });
});
