import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/e2e/production-conversations/route";

describe("production conversation export", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("permanece indisponível sem o modo E2E", async () => {
    vi.stubEnv("E2E_MODE", "false");
    const response = await GET(
      new NextRequest("http://localhost/api/e2e/production-conversations"),
    );

    expect(response.status).toBe(404);
  });

  it("não devolve dados reais nem mesmo com credencial E2E válida", async () => {
    vi.stubEnv("E2E_MODE", "true");
    vi.stubEnv("E2E_SECRET", "test-secret");
    const response = await GET(
      new NextRequest("http://localhost/api/e2e/production-conversations", {
        headers: { "x-e2e-secret": "test-secret" },
      }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "production_conversation_export_disabled",
      replacement: "sanitized_replay_corpus_exporter",
    });
  });
});
