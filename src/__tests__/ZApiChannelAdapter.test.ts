import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getZApiInstanceStatus,
  sendZApiTextMessage,
} from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import { sendTextMessage } from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";

const ENV_KEYS = [
  "WHATSAPP_PROVIDER",
  "ZAPI_INSTANCE_ID",
  "ZAPI_TOKEN",
  "ZAPI_CLIENT_TOKEN",
  "DISABLE_REAL_WHATSAPP_SEND",
] as const;
const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv();
});

describe("sendZApiTextMessage", () => {
  it("ignora Client-Token acidentalmente configurado como URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: "msg-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendZApiTextMessage("5511999999999", "Oi", {
      instanceId: "instance-1",
      token: "token-1",
      clientToken: "https://api.z-api.io/instances/instance-1/token/token-1/send-text",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("envia Client-Token quando ele parece uma credencial válida", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: "msg-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await sendZApiTextMessage("5511999999999", "Oi", {
      instanceId: "instance-1",
      token: "token-1",
      clientToken: "client-token-1",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.z-api.io/instances/instance-1/token/token-1/send-text");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "Client-Token": "client-token-1",
    });
  });
});

describe("getZApiInstanceStatus", () => {
  it("retorna status parseado quando a Z-API responde 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: true, smartphoneConnected: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getZApiInstanceStatus({
        instanceId: "instance-1",
        token: "token-1",
        clientToken: "client-token-1",
      }),
    ).resolves.toMatchObject({
      connected: true,
      smartphoneConnected: true,
    });
  });

  it("retorna erro normalizado quando a Z-API responde com falha", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Instance not found" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getZApiInstanceStatus({
        instanceId: "instance-1",
        token: "token-1",
      }),
    ).resolves.toMatchObject({
      connected: false,
      smartphoneConnected: false,
    });
  });
});

describe("resolveChannelConfig", () => {
  it("não usa credenciais globais de ambiente como fallback", () => {
    process.env.WHATSAPP_PROVIDER = "z_api";
    process.env.ZAPI_INSTANCE_ID = "env-instance";
    process.env.ZAPI_TOKEN = "env-token";
    process.env.ZAPI_CLIENT_TOKEN = "env-client-token";

    const config = resolveChannelConfig({});

    expect(config).toEqual({
      provider: "meta_cloud_api",
      zapi: null,
      meta: null,
    });
  });

  it("resolve Z-API a partir das credenciais da clínica", () => {
    const config = resolveChannelConfig({
      zapiInstanceId: "clinic-instance",
      zapiToken: "clinic-token",
      zapiClientToken: "clinic-client-token",
    });

    expect(config).toEqual({
      provider: "z_api",
      zapi: {
        instanceId: "clinic-instance",
        token: "clinic-token",
        clientToken: "clinic-client-token",
      },
      meta: null,
    });
  });
});

describe("sendTextMessage", () => {
  it("não exige credenciais quando envio real está desabilitado para E2E", async () => {
    process.env.DISABLE_REAL_WHATSAPP_SEND = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendTextMessage("5511999999999", "Oi", {
        provider: "z_api",
        zapi: null,
        meta: null,
      }),
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
