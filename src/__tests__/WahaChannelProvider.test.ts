import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import {
  sendTextMessage,
  sendMediaMessage,
  sendButtonListMessage,
} from "@/infrastructure/adapters/channels/whatsapp/whatsapp-sender";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DISABLE_REAL_WHATSAPP_SEND;
});

const WAHA_CREDS = {
  baseUrl: "https://waha.example.com",
  apiKey: "chave-secreta",
  session: "vitalli",
};

function wahaConfig() {
  return resolveChannelConfig({
    channelProvider: "waha",
    wahaBaseUrl: WAHA_CREDS.baseUrl,
    wahaApiKey: WAHA_CREDS.apiKey,
    wahaSession: WAHA_CREDS.session,
  });
}

function okResponse(body: unknown = { id: "waha-msg-1" }) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("resolveChannelConfig com WAHA", () => {
  it("resolve as credenciais do WAHA quando o provider é waha", () => {
    const config = wahaConfig();

    expect(config.provider).toBe("waha");
    expect(config.waha).toEqual(WAHA_CREDS);
  });

  it("infere o provider waha quando só há credenciais WAHA cadastradas", () => {
    const config = resolveChannelConfig({
      wahaBaseUrl: WAHA_CREDS.baseUrl,
      wahaApiKey: WAHA_CREDS.apiKey,
      wahaSession: WAHA_CREDS.session,
    });

    expect(config.provider).toBe("waha");
  });

  it("remove a barra final da baseUrl para não gerar URL com barra dupla", () => {
    const config = resolveChannelConfig({
      channelProvider: "waha",
      wahaBaseUrl: "https://waha.example.com/",
      wahaApiKey: WAHA_CREDS.apiKey,
      wahaSession: WAHA_CREDS.session,
    });

    expect(config.waha?.baseUrl).toBe("https://waha.example.com");
  });

  it("usa a sessão 'default' quando nenhuma sessão foi cadastrada", () => {
    const config = resolveChannelConfig({
      channelProvider: "waha",
      wahaBaseUrl: WAHA_CREDS.baseUrl,
      wahaApiKey: WAHA_CREDS.apiKey,
    });

    expect(config.waha?.session).toBe("default");
  });
});

describe("sendTextMessage via WAHA", () => {
  it("envia texto no contrato POST /api/sendText do WAHA", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendTextMessage("5511999999999", "Oi", wahaConfig());

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://waha.example.com/api/sendText");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Api-Key": "chave-secreta",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      session: "vitalli",
      chatId: "5511999999999@c.us",
      text: "Oi",
    });
  });

  it("converte markdown de negrito para o formato do WhatsApp", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendTextMessage("5511999999999", "Valor **R$ 100**", wahaConfig());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).text).toBe("Valor *R$ 100*");
  });

  it("devolve o id da mensagem para deduplicar o echo fromMe", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ id: "waha-abc" })));

    const messageId = await sendTextMessage("5511999999999", "Oi", wahaConfig());

    expect(messageId).toBe("waha-abc");
  });

  it("propaga falha do WAHA com status e corpo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("session not found", { status: 422 })),
    );

    await expect(sendTextMessage("5511999999999", "Oi", wahaConfig())).rejects.toThrow(
      /WAHA send failed \(422\): session not found/,
    );
  });

  it("respeita DISABLE_REAL_WHATSAPP_SEND sem chamar a rede", async () => {
    process.env.DISABLE_REAL_WHATSAPP_SEND = "true";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTextMessage("5511999999999", "Oi", wahaConfig());

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendMediaMessage via WAHA", () => {
  it.each([
    ["image", "sendImage"],
    ["video", "sendVideo"],
    ["audio", "sendVoice"],
    ["document", "sendFile"],
  ] as const)("roteia %s para /api/%s", async (mediaType, endpoint) => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage(
      "5511999999999",
      "https://cdn.example.com/arquivo",
      mediaType,
      wahaConfig(),
    );

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://waha.example.com/api/${endpoint}`);
  });

  it("envia a mídia como objeto file com url e legenda", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage(
      "5511999999999",
      "https://cdn.example.com/lente.jpg",
      "image",
      wahaConfig(),
      "Antes e depois",
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.session).toBe("vitalli");
    expect(body.chatId).toBe("5511999999999@c.us");
    expect(body.file.url).toBe("https://cdn.example.com/lente.jpg");
    expect(body.file.mimetype).toBe("image/jpeg");
    expect(body.caption).toBe("Antes e depois");
  });

  it("não manda campo caption quando não há legenda", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage(
      "5511999999999",
      "https://cdn.example.com/lente.jpg",
      "image",
      wahaConfig(),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("caption");
  });

  it("usa o fileName informado no documento", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage(
      "5511999999999",
      "https://cdn.example.com/orcamento.pdf",
      "document",
      wahaConfig(),
      undefined,
      "orcamento.pdf",
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).file.filename).toBe("orcamento.pdf");
  });
});

describe("sendButtonListMessage via WAHA", () => {
  it("degrada para lista numerada em texto, porque GOWS não entrega botões", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendButtonListMessage(
      "5511999999999",
      "Qual horário?",
      [
        { id: "1", label: "09:00" },
        { id: "2", label: "14:00" },
      ],
      wahaConfig(),
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://waha.example.com/api/sendText");
    expect(JSON.parse(init.body as string).text).toBe(
      "Qual horário?\n\n1 — 09:00\n2 — 14:00",
    );
  });
});

describe("regressão: roteamento por provider no whatsapp-sender", () => {
  it("não deixa provider desconhecido cair silenciosamente no ramo da Meta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const config = {
      provider: "provedor_inexistente",
      zapi: null,
      meta: null,
      waha: null,
    } as unknown as ReturnType<typeof resolveChannelConfig>;

    await expect(sendTextMessage("5511999999999", "Oi", config)).rejects.toThrow(
      /Provedor de WhatsApp não suportado: provedor_inexistente/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exige credenciais WAHA configuradas antes de tentar enviar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const config = {
      provider: "waha",
      zapi: null,
      meta: null,
      waha: null,
    } as unknown as ReturnType<typeof resolveChannelConfig>;

    await expect(sendTextMessage("5511999999999", "Oi", config)).rejects.toThrow(
      /WAHA credentials are not configured for this clinic/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
