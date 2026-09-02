import { afterEach, describe, expect, it, vi } from "vitest";
import { probeClinicChannelHealth } from "@/application/health/channel-health";
import {
  hasCompleteChannelConfig,
  type ClinicHealthInput,
} from "@/application/health/clinic-health";

afterEach(() => {
  vi.unstubAllGlobals();
});

const WAHA_CLINIC = {
  clinicId: "11111111-1111-1111-1111-111111111111",
  clinicName: "SystemOps Lab",
  channelProvider: "waha" as const,
  wahaBaseUrl: "https://waha.example.com",
  wahaApiKey: "chave",
  wahaSession: "lab",
};

describe("probeClinicChannelHealth com WAHA", () => {
  it("reporta healthy quando a sessão está WORKING", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: "lab", status: "WORKING" }), { status: 200 }),
      ),
    );

    const health = await probeClinicChannelHealth(WAHA_CLINIC);

    expect(health.status).toBe("healthy");
    expect(health.detail).toBeNull();
  });

  it("consulta o endpoint de sessão do WAHA com a api key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ name: "lab", status: "WORKING" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await probeClinicChannelHealth(WAHA_CLINIC);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://waha.example.com/api/sessions/lab");
    expect(init.headers).toMatchObject({ "X-Api-Key": "chave" });
  });

  it("reporta degraded com o status quando a sessão caiu", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ name: "lab", status: "STOPPED" }), { status: 200 }),
      ),
    );

    const health = await probeClinicChannelHealth(WAHA_CLINIC);

    expect(health.status).toBe("degraded");
    expect(health.detail).toContain("STOPPED");
  });

  it("reporta degraded quando o servidor WAHA está inacessível", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const health = await probeClinicChannelHealth(WAHA_CLINIC);

    expect(health.status).toBe("degraded");
    expect(health.detail).toContain("ECONNREFUSED");
  });

  it("reporta degraded quando faltam credenciais WAHA", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const health = await probeClinicChannelHealth({
      clinicId: WAHA_CLINIC.clinicId,
      clinicName: WAHA_CLINIC.clinicName,
      channelProvider: "waha",
    });

    expect(health.status).toBe("degraded");
    expect(health.detail).toBe("credenciais WAHA ausentes");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("hasCompleteChannelConfig com WAHA", () => {
  const base: ClinicHealthInput = {
    clinicId: "11111111-1111-1111-1111-111111111111",
    clinicName: "SystemOps Lab",
    operationalStatus: "active",
    isDemo: false,
    hasActivePlaybook: true,
  };

  it("aceita a clínica com baseUrl, apiKey e sessão", () => {
    expect(
      hasCompleteChannelConfig({
        ...base,
        channelProvider: "waha",
        wahaBaseUrl: "https://waha.example.com",
        wahaApiKey: "chave",
        wahaSession: "lab",
      }),
    ).toBe(true);
  });

  it("recusa quando falta a apiKey", () => {
    expect(
      hasCompleteChannelConfig({
        ...base,
        channelProvider: "waha",
        wahaBaseUrl: "https://waha.example.com",
        wahaSession: "lab",
      }),
    ).toBe(false);
  });

  it("recusa quando falta a sessão, que é o que resolve o tenant no webhook", () => {
    expect(
      hasCompleteChannelConfig({
        ...base,
        channelProvider: "waha",
        wahaBaseUrl: "https://waha.example.com",
        wahaApiKey: "chave",
      }),
    ).toBe(false);
  });
});
