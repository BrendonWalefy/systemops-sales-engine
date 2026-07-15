import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getZApiInstanceStatus,
  sendZApiTextMessage,
  getZApiQrCodeImage,
  getZApiPhoneCode,
  createZApiInstance,
  applyZApiInstancePreset,
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

describe("getZApiQrCodeImage", () => {
  it("retorna QR base64 quando a API responde 200 com value", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: "base64-string-here", connected: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getZApiQrCodeImage({
      instanceId: "instance-123",
      token: "token-abc",
    });

    expect(result).toEqual({ status: "qr", base64: "base64-string-here" });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.z-api.io/instances/instance-123/token/token-abc/qr-code/image");
  });

  it("retorna status connected quando já estiver conectado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ connected: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getZApiQrCodeImage({
      instanceId: "instance-123",
      token: "token-abc",
    });

    expect(result).toEqual({ status: "connected" });
  });

  it("retorna status expired quando a resposta for HTTP 400 ou 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Instance not initialized" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getZApiQrCodeImage({
      instanceId: "instance-123",
      token: "token-abc",
    });

    expect(result).toEqual({ status: "expired" });
  });

  it("inclui header Client-Token se configurado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: "base64", connected: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getZApiQrCodeImage({
      instanceId: "instance-123",
      token: "token-abc",
      clientToken: "client-token-xyz",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({ "Client-Token": "client-token-xyz" });
  });
});

describe("createZApiInstance", () => {
  it("cria a instância com Authorization Bearer e o preset padrão no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "instance-new", token: "token-new", due: 1_719_000_000_000 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createZApiInstance(
      "Clínica Teste",
      "partner-token-abc",
      "https://app.systemops.com.br/api/whatsapp/zapi",
    );

    expect(result).toEqual({ instanceId: "instance-new", token: "token-new", due: 1_719_000_000_000 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.z-api.io/instances/integrator/on-demand");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer partner-token-abc",
    });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      name: "Clínica Teste",
      receivedCallbackUrl: "https://app.systemops.com.br/api/whatsapp/zapi",
      autoReadMessage: false,
      callRejectAuto: false,
      autoReadStatus: false,
      disableEnqueueWhenDisconnected: false,
      isDevice: false,
    });
  });

  it("lança erro quando a Z-API responde com falha", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Limite de 25 instâncias atingido" }), { status: 403 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createZApiInstance("Clínica Teste", "partner-token-abc", "https://app.systemops.com.br/api/whatsapp/zapi"),
    ).rejects.toThrow(/403/);
  });

  it("lança erro quando a resposta não traz id/token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createZApiInstance("Clínica Teste", "partner-token-abc", "https://app.systemops.com.br/api/whatsapp/zapi"),
    ).rejects.toThrow(/sem id\/token/);
  });
});

describe("applyZApiInstancePreset", () => {
  it("chama notify-sent-by-me e update-filters com os bodies certos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await applyZApiInstancePreset({
      instanceId: "instance-1",
      token: "token-1",
      clientToken: "client-token-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as [string, RequestInit][];

    const notifyCall = calls.find(([url]) => url.endsWith("/update-notify-sent-by-me"));
    expect(notifyCall?.[0]).toBe("https://api.z-api.io/instances/instance-1/token/token-1/update-notify-sent-by-me");
    expect(JSON.parse(notifyCall![1].body as string)).toEqual({ notifySentByMe: true });
    expect(notifyCall![1].headers).toEqual({
      "Content-Type": "application/json",
      "Client-Token": "client-token-1",
    });

    const filtersCall = calls.find(([url]) => url.endsWith("/update-filters"));
    expect(filtersCall?.[0]).toBe("https://api.z-api.io/instances/instance-1/token/token-1/update-filters");
    expect(JSON.parse(filtersCall![1].body as string)).toEqual({ messageFilters: ["FILTER_FROM_GROUP"] });
  });

  it("lança erro se qualquer uma das chamadas falhar", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/update-filters")) {
        return Promise.resolve(new Response("erro interno", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ value: true }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      applyZApiInstancePreset({ instanceId: "instance-1", token: "token-1" }),
    ).rejects.toThrow(/update-filters/);
  });
});

describe("getZApiPhoneCode", () => {
  it("retorna pairing code de 8 dígitos quando a API responde 200 com code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "ABCDEF12" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getZApiPhoneCode(
      { instanceId: "instance-123", token: "token-abc" },
      "5511999999999",
    );

    expect(result).toEqual({ status: "code", code: "ABCDEF12" });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.z-api.io/instances/instance-123/token/token-abc/phone-code/5511999999999");
  });

  it("retorna error se o número de telefone for inválido", async () => {
    const result = await getZApiPhoneCode(
      { instanceId: "instance-123", token: "token-abc" },
      "abc",
    );

    expect(result.status).toBe("error");
  });
});

