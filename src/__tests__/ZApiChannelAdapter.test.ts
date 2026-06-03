import { afterEach, describe, expect, it, vi } from "vitest";
import { sendZApiTextMessage } from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

describe("sendZApiTextMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
