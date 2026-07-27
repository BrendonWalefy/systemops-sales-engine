import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/e2e/replay/scenario/route";

describe("replay scenario route guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("não existe fora do modo E2E", async () => {
    vi.stubEnv("E2E_MODE", "false");
    const response = await POST(new NextRequest(
      "http://localhost/api/e2e/replay/scenario",
      { method: "POST", body: "{}" },
    ));

    expect(response.status).toBe(404);
  });

  it("recusa chamada sem o segredo E2E", async () => {
    vi.stubEnv("E2E_MODE", "true");
    vi.stubEnv("E2E_SECRET", "expected");
    const response = await POST(new NextRequest(
      "http://localhost/api/e2e/replay/scenario",
      { method: "POST", body: "{}" },
    ));

    expect(response.status).toBe(401);
  });
});
